import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import { Clock, Effect, FileSystem, Option, Ref } from "effect";
import { expect, it } from "vitest";

import { createVmFromBase } from "../../src/lib/create-vm-from-base";
import {
  isVmBaseFresh,
  makeVmBaseCacheKey,
  readVmBaseNames,
  VM_BASE_FRESHNESS_MILLIS,
  withVmBaseLock,
  writeVmBaseMetadata,
} from "../../src/lib/vm-base-cache";
import { LimaRuntime } from "../../src/services/lima-runtime";

it("expires bases exactly three days after they are built", () => {
  const metadata = {
    builtAt: 1000,
    cacheKey: "cache-key",
    name: "wvbase-test",
  };

  expect(
    isVmBaseFresh(metadata, metadata.builtAt + VM_BASE_FRESHNESS_MILLIS - 1)
  ).toBe(true);
  expect(
    isVmBaseFresh(metadata, metadata.builtAt + VM_BASE_FRESHNESS_MILLIS)
  ).toBe(false);
  expect(isVmBaseFresh(metadata, metadata.builtAt - 1)).toBe(false);
});

it("invalidates bases when templates or VM configuration change", () => {
  const original = makeVmBaseCacheKey("node", "template-a", ["--vm-type=vz"]);

  expect(makeVmBaseCacheKey("node", "template-b", ["--vm-type=vz"])).not.toBe(
    original
  );
  expect(makeVmBaseCacheKey("python", "template-a", ["--vm-type=vz"])).not.toBe(
    original
  );
  expect(makeVmBaseCacheKey("node", "template-a", ["--vm-type=qemu"])).not.toBe(
    original
  );
});

it("discovers only base names recorded by valid cache metadata", async () => {
  const names = await Effect.runPromise(
    Effect.gen(function* metadataNamesTest() {
      const fs = yield* FileSystem.FileSystem;
      const configPath = yield* fs.makeTempDirectoryScoped();
      yield* writeVmBaseMetadata(configPath, {
        builtAt: 1000,
        cacheKey: "cache-key",
        name: "wvbase-managed",
        retiredNames: ["wvbase-retired"],
      });
      yield* fs.writeFileString(
        `${configPath}/cache/vm-bases/corrupt.json`,
        "not json"
      );
      return yield* readVmBaseNames(configPath);
    }).pipe(Effect.scoped, Effect.provide(BunFileSystem.layer))
  );

  expect(names).toEqual(new Set(["wvbase-managed", "wvbase-retired"]));
});

it("serializes cache work for the same key", async () => {
  const maximumActive = await Effect.runPromise(
    Effect.gen(function* cacheLockTest() {
      const fs = yield* FileSystem.FileSystem;
      const configPath = yield* fs.makeTempDirectoryScoped();
      const active = yield* Ref.make(0);
      const maximum = yield* Ref.make(0);
      const criticalSection = Effect.acquireUseRelease(
        Ref.updateAndGet(active, (count) => count + 1),
        (count) =>
          Ref.update(maximum, (current) => Math.max(current, count)).pipe(
            Effect.andThen(Effect.sleep("50 millis"))
          ),
        () => Ref.update(active, (count) => count - 1)
      );

      yield* Effect.all(
        [
          withVmBaseLock(configPath, "cache-key", criticalSection),
          withVmBaseLock(configPath, "cache-key", criticalSection),
        ],
        { concurrency: "unbounded", discard: true }
      );
      return yield* Ref.get(maximum);
    }).pipe(Effect.scoped, Effect.provide(BunFileSystem.layer))
  );

  expect(maximumActive).toBe(1);
});

it("keeps the base lock until each clone finishes", async () => {
  const maximumActiveClones = await Effect.runPromise(
    Effect.gen(function* cloneLockTest() {
      const fs = yield* FileSystem.FileSystem;
      const configPath = yield* fs.makeTempDirectoryScoped();
      const limaHome = `${configPath}/lima`;
      const cacheKey = "cache-key";
      const baseName = "wvbase-current";
      const activeClones = yield* Ref.make(0);
      const maximumClones = yield* Ref.make(0);
      const lima = LimaRuntime.of({
        assertIsolated: () => Effect.void,
        capture: () => Effect.succeed({ stderr: "", stdout: "" }),
        run: (args) =>
          args[0] === "clone"
            ? Effect.acquireUseRelease(
                Ref.updateAndGet(activeClones, (count) => count + 1),
                (count) =>
                  Ref.update(maximumClones, (current) =>
                    Math.max(current, count)
                  ).pipe(Effect.andThen(Effect.sleep("50 millis"))),
                () => Ref.update(activeClones, (count) => count - 1)
              )
            : Effect.void,
      });
      yield* fs.makeDirectory(`${limaHome}/${baseName}`, { recursive: true });
      yield* writeVmBaseMetadata(configPath, {
        builtAt: yield* Clock.currentTimeMillis,
        cacheKey,
        name: baseName,
      });
      const options = {
        cacheKey,
        configPath,
        cpuCount: 2,
        limaHome,
        memorySize: 2,
        mountArguments: ["--mount-none"],
        progressStartedAt: yield* Clock.currentTimeMillis,
        templateArguments: [],
        vmArguments: [],
      } as const;

      yield* Effect.all(
        [
          createVmFromBase({ ...options, vmName: "first" }),
          createVmFromBase({ ...options, vmName: "second" }),
        ],
        { concurrency: "unbounded", discard: true }
      ).pipe(Effect.provideService(LimaRuntime, lima));

      return yield* Ref.get(maximumClones);
    }).pipe(Effect.scoped, Effect.provide(BunFileSystem.layer))
  );

  expect(maximumActiveClones).toBe(1);
});

it("does not release a lock whose ownership token changed", async () => {
  const replacementLockExists = await Effect.runPromise(
    Effect.gen(function* lockOwnershipTest() {
      const fs = yield* FileSystem.FileSystem;
      const configPath = yield* fs.makeTempDirectoryScoped();
      const lockPath = `${configPath}/cache/vm-bases/cache-key.lock`;
      yield* withVmBaseLock(
        configPath,
        "cache-key",
        fs.writeFileString(
          `${lockPath}/owner.json`,
          JSON.stringify({
            acquiredAt: 0,
            pid: process.pid,
            token: "replacement-owner",
          })
        )
      );
      return yield* fs.exists(lockPath);
    }).pipe(Effect.scoped, Effect.provide(BunFileSystem.layer))
  );

  expect(replacementLockExists).toBe(true);
});

it("does not steal an old lock from a live owner", async () => {
  const lockAttempt = await Effect.runPromise(
    Effect.gen(function* liveLockOwnerTest() {
      const fs = yield* FileSystem.FileSystem;
      const configPath = yield* fs.makeTempDirectoryScoped();
      const lockPath = `${configPath}/cache/vm-bases/cache-key.lock`;
      yield* fs.makeDirectory(lockPath, { recursive: true });
      yield* fs.writeFileString(
        `${lockPath}/owner.json`,
        JSON.stringify({
          acquiredAt: 0,
          pid: process.pid,
          token: "live-owner",
        })
      );
      return yield* withVmBaseLock(configPath, "cache-key", Effect.void).pipe(
        Effect.timeoutOption("20 millis")
      );
    }).pipe(Effect.scoped, Effect.provide(BunFileSystem.layer))
  );

  expect(Option.isNone(lockAttempt)).toBe(true);
});

it("reclaims a lock whose owner process exited", async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* abandonedLockTest() {
      const fs = yield* FileSystem.FileSystem;
      const configPath = yield* fs.makeTempDirectoryScoped();
      const lockPath = `${configPath}/cache/vm-bases/cache-key.lock`;
      yield* fs.makeDirectory(lockPath, { recursive: true });
      yield* fs.writeFileString(
        `${lockPath}/owner.json`,
        JSON.stringify({
          acquiredAt: 0,
          pid: 2_147_483_647,
          token: "abandoned-owner",
        })
      );
      return yield* withVmBaseLock(
        configPath,
        "cache-key",
        Effect.succeed("acquired")
      );
    }).pipe(Effect.scoped, Effect.provide(BunFileSystem.layer))
  );

  expect(result).toBe("acquired");
});
