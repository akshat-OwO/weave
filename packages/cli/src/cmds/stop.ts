import { Effect } from "effect";
import { Argument, Command } from "effect/unstable/cli";

import { VmName } from "../schemas/vm-name.schema";
import { LimaRuntime } from "../services/lima-runtime";

export const stop = Command.make(
  "stop",
  {
    name: Argument.string("name").pipe(
      Argument.withSchema(VmName),
      Argument.withDescription("Name of the VM to stop")
    ),
  },
  ({ name }) =>
    Effect.gen(function* stopHandler() {
      const lima = yield* LimaRuntime;
      yield* lima.run(["stop", "--tty=false", name]);
    })
).pipe(
  Command.withDescription("Stop a running Lima VM without deleting it"),
  Command.withExamples([
    {
      command: "weave stop dev",
    },
  ])
);
