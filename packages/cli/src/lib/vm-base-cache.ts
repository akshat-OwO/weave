import path from "node:path";

import { Clock, Effect, FileSystem, Option, Schema } from "effect";

import cliPackage from "../../package.json" with { type: "json" };
import { LIMA_VERSION } from "../services/user-config";
import { withFileLock } from "./file-lock";

const VmBaseMetadata = Schema.Struct({
  builtAt: Schema.Number,
  cacheKey: Schema.String,
  name: Schema.String,
  retiredNames: Schema.optionalKey(Schema.Array(Schema.String)),
});

const VmBaseMetadataJson = Schema.fromJsonString(VmBaseMetadata);

export type VmBaseMetadata = typeof VmBaseMetadata.Type;

export const VM_BASE_PREFIX = "wvbase-";
export const VM_BASE_FRESHNESS_MILLIS = 3 * 24 * 60 * 60 * 1000;

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

export const withVmBaseLock = <A, E, R>(
  configPath: string,
  cacheKey: string,
  effect: Effect.Effect<A, E, R>
) => withFileLock(vmBaseLockPath(configPath, cacheKey), effect);

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
