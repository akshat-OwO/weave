import path from "node:path";

import type { PlatformError } from "effect";
import { Clock, Effect, FileSystem, Option, Schema } from "effect";

const FileLockOwner = Schema.Struct({
  acquiredAt: Schema.Number,
  pid: Schema.Number,
  token: Schema.String,
});

const FileLockOwnerJson = Schema.fromJsonString(FileLockOwner);

type FileLockOwner = typeof FileLockOwner.Type;
type AcquiredFileLock = FileLockOwner & { readonly lockPath: string };

const FILE_LOCK_RETRY_MILLIS = 250;
const FILE_LOCK_STALE_MILLIS = 2 * 60 * 60 * 1000;
let fileLockSequence = 0;

const fileLockOwnerPath = (lockPath: string): string =>
  path.join(lockPath, "owner.json");

const isAlreadyExists = (error: PlatformError.PlatformError): boolean =>
  error.reason._tag === "AlreadyExists";

const readFileLockOwner = Effect.fn("weave/lib/fileLock/readFileLockOwner")(
  function* readFileLockOwnerHandler(lockPath: string) {
    const fs = yield* FileSystem.FileSystem;
    return yield* fs.readFileString(fileLockOwnerPath(lockPath)).pipe(
      Effect.map(Schema.decodeUnknownOption(FileLockOwnerJson)),
      Effect.catch(() => Effect.succeed(Option.none<FileLockOwner>()))
    );
  }
);

const isProcessAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const tryAcquireFileLock = (
  lockPath: string
): Effect.Effect<
  Option.Option<AcquiredFileLock>,
  PlatformError.PlatformError,
  FileSystem.FileSystem
> =>
  Effect.gen(function* tryAcquireFileLockHandler() {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.makeDirectory(path.dirname(lockPath), { recursive: true });

    const acquired = yield* fs.makeDirectory(lockPath).pipe(
      Effect.as(true),
      Effect.catch((error) =>
        isAlreadyExists(error) ? Effect.succeed(false) : Effect.fail(error)
      )
    );
    if (acquired) {
      const acquiredAt = yield* Clock.currentTimeMillis;
      fileLockSequence += 1;
      const owner = {
        acquiredAt,
        lockPath,
        pid: process.pid,
        token: `${process.pid}-${acquiredAt}-${fileLockSequence}`,
      };
      yield* fs
        .writeFileString(
          fileLockOwnerPath(lockPath),
          Schema.encodeSync(FileLockOwnerJson)(owner)
        )
        .pipe(
          Effect.onError(() =>
            fs
              .remove(lockPath, { force: true, recursive: true })
              .pipe(Effect.ignore)
          )
        );
      return Option.some(owner);
    }

    const owner = yield* readFileLockOwner(lockPath);
    const lockInfo = yield* fs.stat(lockPath).pipe(Effect.option);
    const lockModifiedAt = lockInfo.pipe(Option.flatMap(({ mtime }) => mtime));
    const currentTimeMillis = yield* Clock.currentTimeMillis;
    const ownerIsDead =
      Option.isSome(owner) && !isProcessAlive(owner.value.pid);
    const ownerWasNeverRecorded =
      Option.isNone(owner) &&
      Option.isSome(lockModifiedAt) &&
      currentTimeMillis - lockModifiedAt.value.getTime() >
        FILE_LOCK_STALE_MILLIS;
    yield* ownerIsDead || ownerWasNeverRecorded
      ? fs.remove(lockPath, { force: true, recursive: true })
      : Effect.void;

    return Option.none<AcquiredFileLock>();
  }).pipe(Effect.uninterruptible);

const releaseFileLock = (owner: AcquiredFileLock) =>
  FileSystem.FileSystem.use((fs) =>
    readFileLockOwner(owner.lockPath).pipe(
      Effect.flatMap((currentOwner) =>
        Option.isSome(currentOwner) && currentOwner.value.token === owner.token
          ? fs.remove(owner.lockPath, { force: true, recursive: true })
          : Effect.void
      ),
      Effect.ignore
    )
  );

export const withFileLock = <A, E, R>(
  lockPath: string,
  effect: Effect.Effect<A, E, R>
): Effect.Effect<
  A,
  E | PlatformError.PlatformError,
  R | FileSystem.FileSystem
> =>
  Effect.suspend(() =>
    tryAcquireFileLock(lockPath).pipe(
      Effect.flatMap(
        Option.match({
          onNone: () =>
            Effect.sleep(FILE_LOCK_RETRY_MILLIS).pipe(
              Effect.andThen(withFileLock(lockPath, effect))
            ),
          onSome: (owner) =>
            Effect.acquireUseRelease(
              Effect.succeed(owner),
              () => effect,
              releaseFileLock
            ),
        })
      )
    )
  );
