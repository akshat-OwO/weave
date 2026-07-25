import { Effect } from "effect";
import { Argument, Command } from "effect/unstable/cli";

import { VmName } from "../schemas/vm-name.schema";
import { LimaRuntime } from "../services/lima-runtime";

export const shell = Command.make(
  "shell",
  {
    name: Argument.string("name").pipe(
      Argument.withSchema(VmName),
      Argument.withDescription("Name of the running VM")
    ),
    shellCommand: Argument.string("command").pipe(
      Argument.withDescription("Shell command to execute in the VM")
    ),
  },
  ({ name, shellCommand }) =>
    Effect.gen(function* shellHandler() {
      const lima = yield* LimaRuntime;
      yield* lima.assertIsolated(name);
      yield* lima.run([
        "shell",
        name,
        "--",
        "sh",
        "-lc",
        'shell="$SHELL"; test -n "$shell" || shell=/bin/sh; exec "$shell" -lic "$1"',
        "weave-shell",
        shellCommand,
      ]);
    })
).pipe(
  Command.withDescription("Run a shell command in a Lima VM"),
  Command.withExamples([
    {
      command: 'weave shell dev "uname -a"',
    },
  ])
);
