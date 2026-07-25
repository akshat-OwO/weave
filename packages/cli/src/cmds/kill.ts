import { Effect } from "effect";
import { Argument, Command } from "effect/unstable/cli";

import { VmName } from "../schemas/vm-name.schema";
import { LimaRuntime } from "../services/lima-runtime";

export const kill = Command.make(
  "kill",
  {
    name: Argument.string("name").pipe(
      Argument.withSchema(VmName),
      Argument.withDescription("Name of the VM to permanently delete")
    ),
  },
  ({ name }) =>
    Effect.gen(function* killHandler() {
      const lima = yield* LimaRuntime;
      yield* lima.run(["delete", "--force", "--tty=false", name]);
    })
).pipe(
  Command.withDescription("Permanently delete a Lima VM"),
  Command.withExamples([
    {
      command: "weave kill dev",
    },
  ])
);
