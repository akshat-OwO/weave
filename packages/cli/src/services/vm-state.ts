import path from "node:path";

import {
  Clock,
  Context,
  Effect,
  FileSystem,
  Layer,
  Option,
  Schedule,
  Schema,
} from "effect";

import type { VmRecord } from "../schemas/vm-record.schema";
import { VmRecordJson } from "../schemas/vm-record.schema";
import { UserConfig } from "./user-config";

const metadataFileName = "vm.json";
const lockOwnerFileName = "owner.json";
const LOCK_OWNER_WRITE_GRACE_MILLIS = 10_000;

const LockOwner = Schema.Struct({
  acquiredAt: Schema.Number,
  pid: Schema.Int,
});

const LockOwnerJson = Schema.fromJsonString(LockOwner);

export interface VmStateService {
  readonly get: (
    name: string
  ) => Effect.Effect<Option.Option<VmRecord>, unknown, never>;
  readonly list: () => Effect.Effect<readonly VmRecord[], unknown, never>;
  readonly remove: (name: string) => Effect.Effect<void, unknown, never>;
  readonly withLock: <A, E, R>(
    effect: Effect.Effect<A, E, R>
  ) => Effect.Effect<A, E | unknown, R>;
  readonly write: (record: VmRecord) => Effect.Effect<void, unknown, never>;
}

export const VmState = Context.Service<VmStateService>(
  "weave/services/vmState"
);

export const vmStateDirectory = (configPath: string, name: string): string =>
  path.join(configPath, "vms", name);

export const vmStatePath = (configPath: string, name: string): string =>
  path.join(vmStateDirectory(configPath, name), metadataFileName);

export const VmStateLive = Layer.effect(
  VmState,
  Effect.gen(function* vmStateHandler() {
    const fs = yield* FileSystem.FileSystem;
    const userConfig = yield* UserConfig;
    const root = path.join(userConfig.configPath, "vms");
    const lockDirectory = path.join(
      userConfig.configPath,
      ".vm-operation.lock"
    );
    const lockOwnerPath = path.join(lockDirectory, lockOwnerFileName);
    const get = Effect.fn("weave/services/vmState/get")(function* getHandler(
      name: string
    ) {
      const statePath = vmStatePath(userConfig.configPath, name);
      if (!(yield* fs.exists(statePath))) {
        return Option.none<VmRecord>();
      }

      return Option.some(
        yield* fs
          .readFileString(statePath)
          .pipe(Effect.flatMap(Schema.decodeUnknownEffect(VmRecordJson)))
      );
    });

    const processIsRunning = Effect.fn(
      "weave/services/vmState/processIsRunning"
    )(function* processIsRunningHandler(pid: number) {
      return yield* Effect.try({
        catch: (cause) => cause,
        try: () => {
          process.kill(pid, 0);
          return true;
        },
      }).pipe(Effect.catch(() => Effect.succeed(false)));
    });
    const acquireLock = Effect.fn("weave/services/vmState/acquireLock")(
      function* acquireLockHandler() {
        const acquiredAt = yield* Clock.currentTimeMillis;
        return yield* fs.makeDirectory(lockDirectory).pipe(
          Effect.tap(() =>
            fs.writeFileString(
              lockOwnerPath,
              Schema.encodeSync(LockOwnerJson)({
                acquiredAt,
                pid: process.pid,
              })
            )
          ),
          Effect.asVoid,
          Effect.catch((lockError) =>
            Effect.gen(function* recoverStaleLock() {
              const owner = yield* fs
                .readFileString(lockOwnerPath)
                .pipe(
                  Effect.flatMap(Schema.decodeUnknownEffect(LockOwnerJson)),
                  Effect.option
                );
              const lockInfo = yield* fs
                .stat(lockDirectory)
                .pipe(Effect.option);
              const lockModifiedAt = lockInfo.pipe(
                Option.flatMap(({ mtime }) => mtime)
              );
              const ownerlessLockIsStale =
                Option.isNone(owner) &&
                Option.isSome(lockModifiedAt) &&
                acquiredAt - lockModifiedAt.value.getTime() >
                  LOCK_OWNER_WRITE_GRACE_MILLIS;
              const ownedLockIsStale =
                Option.isSome(owner) &&
                acquiredAt - owner.value.acquiredAt >
                  LOCK_OWNER_WRITE_GRACE_MILLIS &&
                !(yield* processIsRunning(owner.value.pid));
              if (ownerlessLockIsStale || ownedLockIsStale) {
                yield* fs.remove(lockDirectory, {
                  force: true,
                  recursive: true,
                });
              }
              return yield* Effect.fail(lockError);
            })
          )
        );
      }
    );

    return VmState.of({
      get,
      list: () =>
        Effect.gen(function* listHandler() {
          if (!(yield* fs.exists(root))) {
            return [];
          }

          const names = yield* fs.readDirectory(root);
          const records: VmRecord[] = [];
          for (const name of names.toSorted()) {
            const record = yield* get(name);
            if (Option.isSome(record)) {
              records.push(record.value);
            }
          }
          return records;
        }),
      remove: (name) =>
        fs.remove(vmStateDirectory(userConfig.configPath, name), {
          force: true,
          recursive: true,
        }),
      withLock: (effect) =>
        Effect.acquireUseRelease(
          acquireLock().pipe(
            Effect.retry(
              Schedule.spaced("50 millis").pipe(Schedule.upTo({ times: 200 }))
            )
          ),
          () => effect,
          () =>
            fs.remove(lockDirectory, {
              force: true,
              recursive: true,
            })
        ),
      write: (record) =>
        Effect.gen(function* writeHandler() {
          const directory = vmStateDirectory(
            userConfig.configPath,
            record.name
          );
          yield* fs.makeDirectory(directory, { recursive: true });
          const statePath = vmStatePath(userConfig.configPath, record.name);
          const temporaryPath = `${statePath}.${process.pid}.tmp`;
          yield* fs.writeFileString(
            temporaryPath,
            Schema.encodeSync(VmRecordJson)(record)
          );
          yield* fs.rename(temporaryPath, statePath);
        }),
    });
  })
);
