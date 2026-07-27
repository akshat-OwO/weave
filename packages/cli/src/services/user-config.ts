import os from "node:os";
import path from "node:path";

import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import { Context, Effect, FileSystem, Layer, Match } from "effect";

import runtimeAssetPath from "../runtime";
import { ArchiveBytesError } from "../schemas/errors/install-runtime/archive-bytes.schema";
import { ArchiveExtractError } from "../schemas/errors/install-runtime/archive-extract.schema";

export const UserConfig = Context.Service<{
  configPath: string;
  lima: {
    runtime: string;
    executable: string;
    home: string;
  };
  init: () => Effect.Effect<void>;
}>("weave/services/userConfig");

const configPathForPlatform = (): string =>
  Match.value(process.platform).pipe(
    Match.when("win32", () =>
      // oxlint-disable-next-line no-non-null-assertion
      path.join(process.env.APPDATA!, "weave")
    ),
    Match.orElse(() => path.join(os.homedir(), "weave"))
  );

interface RuntimePaths {
  readonly runtime: string;
  readonly executable: string;
  readonly runtimeState: string;
}

const LIMA_VERSION = "2.2.0";

const installRuntime = Effect.fn(
  "weave/services/userConfig/helper/installRuntime"
)(function* installRuntimeHandler(
  fs: FileSystem.FileSystem,
  paths: RuntimePaths
) {
  const runtimeExists = yield* fs.exists(paths.runtime);
  if (!runtimeExists) {
    yield* fs.makeDirectory(paths.runtime, { recursive: true });
  }

  const executableExists = yield* fs.exists(paths.executable);
  if (executableExists) {
    return;
  }

  yield* fs.makeDirectory(paths.runtimeState, { recursive: true });

  const archiveBytes = yield* Effect.tryPromise({
    catch: () => new ArchiveBytesError(),
    try: () => Bun.file(runtimeAssetPath).bytes(),
  });

  yield* Effect.tryPromise({
    catch: () => new ArchiveExtractError(),
    try: () => new Bun.Archive(archiveBytes).extract(paths.runtime),
  });

  if (process.platform !== "win32") {
    yield* fs.chmod(paths.executable, 0o755);
  }
});

export const UserConfigLive = Layer.effect(
  UserConfig,
  Effect.gen(function* handler() {
    const fs = yield* FileSystem.FileSystem;

    const configPath = configPathForPlatform();
    const runtimePath = path.join(configPath, "runtimes", "lima", LIMA_VERSION);
    const runtimeStatePath = path.join(runtimePath, "state");
    const executablePath = path.join(
      runtimePath,
      "bin",
      process.platform === "win32" ? "limactl.exe" : "limactl"
    );

    return UserConfig.of({
      configPath,
      init: () =>
        Effect.gen(function* initHandler() {
          yield* installRuntime(fs, {
            executable: executablePath,
            runtime: runtimePath,
            runtimeState: runtimeStatePath,
          });
        }).pipe(
          Effect.catch((error) => {
            const message = Match.value(error._tag).pipe(
              Match.when(
                "ArchiveBytesError",
                () => "Failed to download lima archive"
              ),
              Match.when(
                "ArchiveExtractError",
                () => "Failed to extract lima archive"
              ),
              Match.orElse(() => "Unknown error")
            );

            return Effect.die(message);
          })
        ),
      lima: {
        executable: executablePath,
        home: runtimeStatePath,
        runtime: runtimePath,
      },
    });
  }).pipe(
    Effect.provide(BunFileSystem.layer),
    Effect.catch(() => Effect.die("Unknown error"))
  )
);
