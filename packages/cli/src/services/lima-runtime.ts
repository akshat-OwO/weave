import path from "node:path";

import type { PlatformError } from "effect";
import { Context, Effect, Layer } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { UserConfig, UserConfigLive } from "./user-config";

export const LimaRuntime = Context.Service<{
  run: (
    args: readonly string[]
  ) => Effect.Effect<void, PlatformError.PlatformError, never>;
}>("weave/services/limaRuntime");

export const LimaRuntimeLive = Layer.effect(
  LimaRuntime,
  Effect.gen(function* handler() {
    const userConfig = yield* UserConfig;
    const process = yield* ChildProcessSpawner.ChildProcessSpawner;

    return LimaRuntime.of({
      run: (args) =>
        Effect.gen(function* runHandler() {
          const command = ChildProcess.make(userConfig.lima.executable, args, {
            env: {
              ...Bun.env,
              LIMA_HOME: userConfig.lima.home,
              LIMA_TEMPLATES_PATH: path.join(
                userConfig.lima.runtime,
                "share",
                "lima",
                "templates"
              ),
            },
            extendEnv: true,
            stderr: "inherit",
            stdin: "inherit",
            stdout: "inherit",
          });

          const exitCode = yield* process.exitCode(command);

          if (exitCode !== 0) {
            return yield* Effect.die(`Command exited with code ${exitCode}`);
          }
        }),
    });
  }).pipe(Effect.provide(UserConfigLive))
);
