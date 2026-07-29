import path from "node:path";

import type { PlatformError } from "effect";
import { Clock, Effect, FileSystem, Option, Schema } from "effect";

import cliPackage from "../../package.json" with { type: "json" };
import { LIMA_VERSION } from "../services/user-config";

const VmBaseMetadata = Schema.Struct({
  builtAt: Schema.Number,
  cacheKey: Schema.String,
  name: Schema.String,
  retiredNames: Schema.optionalKey(Schema.Array(Schema.String)),
});

const VmBaseMetadataJson = Schema.fromJsonString(VmBaseMetadata);

export type VmBaseMetadata = typeof VmBaseMetadata.Type;

const VmBaseLockOwner = Schema.Struct({
  acquiredAt: Schema.Number,
  pid: Schema.Number,
  token: Schema.String,
});

const VmBaseLockOwnerJson = Schema.fromJsonString(VmBaseLockOwner);

type VmBaseLockOwner = typeof VmBaseLockOwner.Type;

export const VM_BASE_PREFIX = "wvbase-";
export const VM_BASE_FRESHNESS_MILLIS = 3 * 24 * 60 * 60 * 1000;
const VM_BASE_LOCK_RETRY_MILLIS = 250;
const VM_BASE_LOCK_STALE_MILLIS = 2 * 60 * 60 * 1000;
let vmBaseLockSequence = 0;

const vmBackend = process.platform === "darwin" ? "vz" : "qemu";

const digest = (value: string): string =>
  new Bun.CryptoHasher("sha256").update(value).digest("hex");

export const makeVmBaseCacheKey = (
  templateName: string,
  templateFingerprint: string,
  vmArguments: readonly string[]
): string =>
  digest(
    JSON.stringify({
      architecture: process.arch,
      backend: vmBackend,
      limaVersion: LIMA_VERSION,
      templateFingerprint,
      templateName,
      vmArguments,
      weaveVersion: cliPackage.version,
    })
  );

export const makeVmBaseName = (cacheKey: string, builtAt: number): string =>
  `${VM_BASE_PREFIX}${cacheKey.slice(0, 8)}-${builtAt.toString(36)}-${process.pid.toString(36)}`;

const metadataDirectory = (configPath: string): string =>
  path.join(configPath, "cache", "vm-bases");

const vmBaseLockPath = (configPath: string, cacheKey: string): string =>
  path.join(metadataDirectory(configPath), `${cacheKey}.lock`);

const vmBaseLockOwnerPath = (lockPath: string): string =>
  path.join(lockPath, "owner.json");

export const vmBaseMetadataPath = (
  configPath: string,
  cacheKey: string
): string => path.join(metadataDirectory(configPath), `${cacheKey}.json`);

const decodeVmBaseMetadata = (
  contents: string
): Option.Option<VmBaseMetadata> =>
  Schema.decodeUnknownOption(VmBaseMetadataJson)(contents);

export const readVmBaseMetadata = Effect.fn(
  "weave/lib/vmBaseCache/readVmBaseMetadata"
)(function* readVmBaseMetadataHandler(configPath: string, cacheKey: string) {
  const fs = yield* FileSystem.FileSystem;
  const metadataPath = vmBaseMetadataPath(configPath, cacheKey);
  const exists = yield* fs.exists(metadataPath);

  if (!exists) {
    return Option.none<VmBaseMetadata>();
  }

  return yield* fs.readFileString(metadataPath).pipe(
    Effect.map((contents) =>
      decodeVmBaseMetadata(contents).pipe(
        Option.filter((metadata) => metadata.cacheKey === cacheKey)
      )
    ),
    Effect.catch(() => Effect.succeed(Option.none<VmBaseMetadata>()))
  );
});

export const writeVmBaseMetadata = Effect.fn(
  "weave/lib/vmBaseCache/writeVmBaseMetadata"
)(function* writeVmBaseMetadataHandler(
  configPath: string,
  metadata: VmBaseMetadata
) {
  const fs = yield* FileSystem.FileSystem;
  const directory = metadataDirectory(configPath);
  yield* fs.makeDirectory(directory, { recursive: true });
  const temporaryPath = yield* fs.makeTempFile({
    directory,
    prefix: `${metadata.cacheKey}.`,
    suffix: ".tmp",
  });
  const temporaryDirectory = path.dirname(temporaryPath);
  yield* Effect.gen(function* writeVmBaseMetadataFile() {
    yield* fs.writeFileString(
      temporaryPath,
      Schema.encodeSync(VmBaseMetadataJson)(metadata)
    );
    yield* fs.rename(
      temporaryPath,
      vmBaseMetadataPath(configPath, metadata.cacheKey)
    );
  }).pipe(
    Effect.ensuring(
      fs
        .remove(temporaryDirectory, { force: true, recursive: true })
        .pipe(Effect.ignore)
    )
  );
});

export const readVmBaseNames = Effect.fn(
  "weave/lib/vmBaseCache/readVmBaseNames"
)(function* readVmBaseNamesHandler(configPath: string) {
  const fs = yield* FileSystem.FileSystem;
  const directory = metadataDirectory(configPath);
  const entries = yield* fs
    .readDirectory(directory)
    .pipe(Effect.catch(() => Effect.succeed([])));
  const metadata = yield* Effect.forEach(
    entries.filter((entry) => entry.endsWith(".json")),
    (entry) =>
      fs.readFileString(path.join(directory, entry)).pipe(
        Effect.map((contents) =>
          decodeVmBaseMetadata(contents).pipe(
            Option.filter(
              (decodedMetadata) => entry === `${decodedMetadata.cacheKey}.json`
            )
          )
        ),
        Effect.catch(() => Effect.succeed(Option.none<VmBaseMetadata>()))
      )
  );

  return new Set(
    metadata.flatMap(
      Option.match({
        onNone: () => [],
        onSome: ({ name, retiredNames }) => [name, ...(retiredNames ?? [])],
      })
    )
  );
});

const isAlreadyExists = (error: PlatformError.PlatformError): boolean =>
  error.reason._tag === "AlreadyExists";

const readVmBaseLockOwner = Effect.fn(
  "weave/lib/vmBaseCache/readVmBaseLockOwner"
)(function* readVmBaseLockOwnerHandler(lockPath: string) {
  const fs = yield* FileSystem.FileSystem;
  return yield* fs.readFileString(vmBaseLockOwnerPath(lockPath)).pipe(
    Effect.map(Schema.decodeUnknownOption(VmBaseLockOwnerJson)),
    Effect.catch(() => Effect.succeed(Option.none<VmBaseLockOwner>()))
  );
});

const isProcessAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

type AcquiredVmBaseLock = VmBaseLockOwner & { readonly lockPath: string };

const tryAcquireVmBaseLock = (
  configPath: string,
  cacheKey: string
): Effect.Effect<
  Option.Option<AcquiredVmBaseLock>,
  PlatformError.PlatformError,
  FileSystem.FileSystem
> =>
  Effect.gen(function* tryAcquireVmBaseLockHandler() {
    const fs = yield* FileSystem.FileSystem;
    const directory = metadataDirectory(configPath);
    const lockPath = vmBaseLockPath(configPath, cacheKey);
    yield* fs.makeDirectory(directory, { recursive: true });

    const acquired = yield* fs.makeDirectory(lockPath).pipe(
      Effect.as(true),
      Effect.catch((error) =>
        isAlreadyExists(error) ? Effect.succeed(false) : Effect.fail(error)
      )
    );
    if (acquired) {
      const acquiredAt = yield* Clock.currentTimeMillis;
      vmBaseLockSequence += 1;
      const owner = {
        acquiredAt,
        lockPath,
        pid: process.pid,
        token: `${process.pid}-${acquiredAt}-${vmBaseLockSequence}`,
      };
      const writeOwner = fs.writeFileString(
        vmBaseLockOwnerPath(lockPath),
        Schema.encodeSync(VmBaseLockOwnerJson)(owner)
      );
      yield* writeOwner.pipe(
        Effect.onError(() =>
          fs
            .remove(lockPath, { force: true, recursive: true })
            .pipe(Effect.ignore)
        )
      );
      return Option.some(owner);
    }

    const owner = yield* readVmBaseLockOwner(lockPath);
    const lockInfo = yield* fs.stat(lockPath).pipe(Effect.option);
    const lockModifiedAt = lockInfo.pipe(Option.flatMap(({ mtime }) => mtime));
    const currentTimeMillis = yield* Clock.currentTimeMillis;
    const ownerIsDead =
      Option.isSome(owner) && !isProcessAlive(owner.value.pid);
    const ownerWasNeverRecorded =
      Option.isNone(owner) &&
      Option.isSome(lockModifiedAt) &&
      currentTimeMillis - lockModifiedAt.value.getTime() >
        VM_BASE_LOCK_STALE_MILLIS;
    yield* ownerIsDead || ownerWasNeverRecorded
      ? fs.remove(lockPath, { force: true, recursive: true })
      : Effect.void;

    return Option.none<AcquiredVmBaseLock>();
  }).pipe(Effect.uninterruptible);

const releaseVmBaseLock = (owner: AcquiredVmBaseLock) =>
  FileSystem.FileSystem.use((fs) =>
    readVmBaseLockOwner(owner.lockPath).pipe(
      Effect.flatMap((currentOwner) =>
        Option.isSome(currentOwner) && currentOwner.value.token === owner.token
          ? fs.remove(owner.lockPath, { force: true, recursive: true })
          : Effect.void
      ),
      Effect.ignore
    )
  );

export const withVmBaseLock = <A, E, R>(
  configPath: string,
  cacheKey: string,
  effect: Effect.Effect<A, E, R>
): Effect.Effect<
  A,
  E | PlatformError.PlatformError,
  R | FileSystem.FileSystem
> =>
  Effect.suspend(() =>
    tryAcquireVmBaseLock(configPath, cacheKey).pipe(
      Effect.flatMap(
        Option.match({
          onNone: () =>
            Effect.sleep(VM_BASE_LOCK_RETRY_MILLIS).pipe(
              Effect.andThen(withVmBaseLock(configPath, cacheKey, effect))
            ),
          onSome: (owner) =>
            Effect.acquireUseRelease(
              Effect.succeed(owner),
              () => effect,
              releaseVmBaseLock
            ),
        })
      )
    )
  );

export const isVmBaseFresh = (
  metadata: VmBaseMetadata,
  currentTimeMillis: number
): boolean => {
  const age = currentTimeMillis - metadata.builtAt;
  return age >= 0 && age < VM_BASE_FRESHNESS_MILLIS;
};

export const freshVmBase = Effect.fn("weave/lib/vmBaseCache/freshVmBase")(
  function* freshVmBaseHandler(
    configPath: string,
    limaHome: string,
    cacheKey: string
  ) {
    const fs = yield* FileSystem.FileSystem;
    const metadata = yield* readVmBaseMetadata(configPath, cacheKey);

    if (Option.isNone(metadata)) {
      return Option.none<string>();
    }

    const currentTimeMillis = yield* Clock.currentTimeMillis;
    if (!isVmBaseFresh(metadata.value, currentTimeMillis)) {
      return Option.none<string>();
    }

    const baseExists = yield* fs.exists(
      path.join(limaHome, metadata.value.name)
    );
    return baseExists
      ? Option.some(metadata.value.name)
      : Option.none<string>();
  }
);
