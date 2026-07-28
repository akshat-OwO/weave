import { Effect, FileSystem } from "effect";
import { Argument, Flag } from "effect/unstable/cli";

import { InvalidMountPathError } from "../schemas/errors/invalid-mount-path.schema";

export const mount = Flag.boolean("mount").pipe(
  Flag.atMost(1),
  Flag.withDescription(
    "Mount the following host directories; append :w for writable access"
  )
);

export const mountPaths = Argument.variadic(Argument.string("mount-path")).pipe(
  Argument.withDescription("Host directories supplied after --mount")
);

export const limaMountArguments = (
  paths: readonly string[]
): readonly string[] =>
  paths.length === 0
    ? ["--mount-none"]
    : paths.map((mountPath) => `--mount-only=${mountPath}`);

const mountLocation = (mountPath: string): string =>
  mountPath.endsWith(":w") ? mountPath.slice(0, -2) : mountPath;

export const validateMountDirectories = Effect.fn(
  "weave/lib/vmMounts/validateMountDirectories"
)(function* validateMountDirectoriesHandler(paths: readonly string[]) {
  const fs = yield* FileSystem.FileSystem;

  for (const mountPath of paths) {
    const location = mountLocation(mountPath);
    const exists = yield* fs.exists(location);
    if (!exists) {
      return yield* new InvalidMountPathError({
        path: mountPath,
        reason: "directory does not exist",
      });
    }

    const info = yield* fs.stat(location);
    if (info.type !== "Directory") {
      return yield* new InvalidMountPathError({
        path: mountPath,
        reason: "expected a directory",
      });
    }
  }

  return paths;
});
