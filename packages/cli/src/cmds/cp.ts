import { Crypto, Effect } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";

import { VmName } from "../schemas/vm-name.schema";
import { LimaRuntime } from "../services/lima-runtime";

const instance = Argument.string("name").pipe(
  Argument.withSchema(VmName),
  Argument.withDescription("Name of the running VM")
);

const sources = Argument.string("file").pipe(
  Argument.variadic({ min: 1 }),
  Argument.withDescription("Host files to copy into the VM")
);

const output = Flag.string("o").pipe(
  Flag.withDefault("~"),
  Flag.withMetavar("DIRECTORY"),
  Flag.withDescription("Destination directory in the VM; defaults to ~")
);

const checkDestinationAccess =
  'if mkdir -p -- "$1" 2>/dev/null && [ -w "$1" ]; then printf writable; else printf protected; fi';
const installStagedFiles =
  'destination=$1; if [ ! -d "$destination" ]; then sudo mkdir -p -- "$destination" && sudo chown "$(id -u):$(id -g)" -- "$destination" || exit; fi; sudo cp -a -- "$2"/. "$destination"/';

export const cp = Command.make(
  "cp",
  { instance, output, sources },
  ({ instance: vmName, output: guestDirectory, sources: hostFiles }) =>
    Effect.gen(function* cpHandler() {
      const lima = yield* LimaRuntime;
      yield* lima.assertIsolated(vmName);
      const destination =
        guestDirectory === "~"
          ? (yield* lima.capture([
              "shell",
              vmName,
              "--",
              "sh",
              "-c",
              'printf "%s" "$HOME"',
            ])).stdout
          : guestDirectory;
      const destinationAccess = yield* lima.capture([
        "shell",
        vmName,
        "--",
        "sh",
        "-c",
        checkDestinationAccess,
        "weave-cp",
        destination,
      ]);

      if (destinationAccess.stdout === "writable") {
        return yield* lima.run([
          "copy",
          ...hostFiles,
          `${vmName}:${destination}/`,
        ]);
      }

      const crypto = yield* Crypto.Crypto;
      const transferId = yield* crypto.randomUUIDv7;
      const stagingDirectory = `/tmp/weave-cp-${transferId}`;
      yield* lima.run(["shell", vmName, "--", "mkdir", "-p", stagingDirectory]);
      yield* Effect.gen(function* copyHandler() {
        yield* lima.run([
          "copy",
          ...hostFiles,
          `${vmName}:${stagingDirectory}/`,
        ]);
        yield* lima.run([
          "shell",
          vmName,
          "--",
          "sh",
          "-c",
          installStagedFiles,
          "weave-cp",
          destination,
          stagingDirectory,
        ]);
      }).pipe(
        Effect.ensuring(
          lima
            .run(["shell", vmName, "--", "rm", "-rf", stagingDirectory])
            .pipe(Effect.ignore)
        )
      );
    })
).pipe(
  Command.withDescription("Copy host files into a Lima VM"),
  Command.withExamples([
    {
      command: "weave cp dev ./package.json ./src/index.ts --o /dev",
    },
    {
      command: "weave cp dev ./package.json",
    },
  ])
);
