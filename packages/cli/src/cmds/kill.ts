import { Clock, Console, Effect } from "effect";
import { Argument, Command } from "effect/unstable/cli";

import { VmName } from "../schemas/vm-name.schema";
import { VmManager } from "../services/vm-manager";

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
      const startedAt = yield* Clock.currentTimeMillis;
      const manager = yield* VmManager;
      yield* manager.kill(name);
      const finishedAt = yield* Clock.currentTimeMillis;
      const elapsedSeconds = Math.max(
        0,
        Math.round((finishedAt - startedAt) / 1000)
      );
      yield* Console.log(`✔ Deleted ${name} in ${elapsedSeconds}s`);
    })
).pipe(
  Command.withDescription("Permanently delete a Firecracker VM"),
  Command.withExamples([{ command: "weave kill dev" }])
);
