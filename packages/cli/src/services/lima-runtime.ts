import path from "node:path";

import type { PlatformError } from "effect";
import { Context, Effect, Layer } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { UnsafeVmBackendError } from "../schemas/errors/unsafe-vm-backend.schema";
import { UserConfig, UserConfigLive } from "./user-config";

interface RunOptions {
  readonly acceptableExitCodes?: readonly number[];
}

export const LimaRuntime = Context.Service<{
  assertIsolated: (
    instance: string
  ) => Effect.Effect<
    void,
    PlatformError.PlatformError | UnsafeVmBackendError,
    never
  >;
  run: (
    args: readonly string[],
    options?: RunOptions
  ) => Effect.Effect<void, PlatformError.PlatformError, never>;
}>("weave/services/limaRuntime");

export const LimaRuntimeLive = Layer.effect(
  LimaRuntime,
  Effect.gen(function* handler() {
    const userConfig = yield* UserConfig;
    const processSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const environment = {
      ...Bun.env,
      LIMA_HOME: userConfig.lima.home,
      LIMA_TEMPLATES_PATH: path.join(
        userConfig.lima.runtime,
        "share",
        "lima",
        "templates"
      ),
    };

    return LimaRuntime.of({
      assertIsolated: (instance) =>
        Effect.gen(function* assertIsolatedHandler() {
          if (process.platform === "win32") {
            const command = ChildProcess.make(
              userConfig.lima.executable,
              ["list", instance, "--format={{.VMType}}"],
              {
                env: environment,
                extendEnv: true,
              }
            );
            const backend = (yield* processSpawner.string(command)).trim();

            if (backend !== "qemu") {
              return yield* new UnsafeVmBackendError({
                backend,
                name: instance,
              });
            }
          }
        }),
      run: (args, options) =>
        Effect.gen(function* runHandler() {
          const command = ChildProcess.make(userConfig.lima.executable, args, {
            env: environment,
            extendEnv: true,
            stderr: "inherit",
            stdin: "inherit",
            stdout: "inherit",
          });

          const exitCode = yield* processSpawner.exitCode(command);
          const acceptableExitCodes = options?.acceptableExitCodes ?? [0];

          if (!acceptableExitCodes.includes(exitCode)) {
            return yield* Effect.die(`Command exited with code ${exitCode}`);
          }
        }),
    });
  }).pipe(Effect.provide(UserConfigLive))
);
