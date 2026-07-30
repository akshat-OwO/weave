import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import { Effect, FileSystem, Ref } from "effect";
import { expect, it } from "vitest";

import { withVmLock } from "../../src/lib/vm-lock";

it("serializes lifecycle changes for the same VM", async () => {
  const maximumActive = await Effect.runPromise(
    Effect.gen(function* vmLockTest() {
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
          withVmLock(configPath, "dev", criticalSection),
          withVmLock(configPath, "dev", criticalSection),
        ],
        { concurrency: "unbounded", discard: true }
      );
      return yield* Ref.get(maximum);
    }).pipe(Effect.scoped, Effect.provide(BunFileSystem.layer))
  );

  expect(maximumActive).toBe(1);
});
