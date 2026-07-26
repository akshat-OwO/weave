import { Clock, Console, Effect } from "effect";
import { Argument, Command } from "effect/unstable/cli";

import { VmName } from "../schemas/vm-name.schema";
import { VmManager } from "../services/vm-manager";

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
      const startedAt = yield* Clock.currentTimeMillis;
      const manager = yield* VmManager;
      yield* manager.stop(name);
      const finishedAt = yield* Clock.currentTimeMillis;
      const elapsedSeconds = Math.max(
        0,
        Math.round((finishedAt - startedAt) / 1000)
      );
      yield* Console.log(`✔ Stopped ${name} in ${elapsedSeconds}s`);
    })
).pipe(
  Command.withDescription("Stop a Firecracker VM without deleting its disk"),
  Command.withExamples([{ command: "weave stop dev" }])
);
