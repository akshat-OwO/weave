import { Clock, Console, Effect } from "effect";
import { Argument, Command } from "effect/unstable/cli";

import { withVmLock } from "../lib/vm-lock";
import { VmName } from "../schemas/vm-name.schema";
import { LimaRuntime } from "../services/lima-runtime";
import { UserConfig } from "../services/user-config";

export const stop = Command.make(
  "stop",
  {
    name: Argument.string("name").pipe(
      Argument.withSchema(VmName),
      Argument.withDescription("Name of the VM to stop")
    ),
  },
  ({ name }) =>
    UserConfig.use((userConfig) =>
      withVmLock(
        userConfig.configPath,
        name,
        Effect.gen(function* stopHandler() {
          const startedAt = yield* Clock.currentTimeMillis;
          const lima = yield* LimaRuntime;
          yield* lima.run(["stop", "--tty=false", name], {
            progress: {
              failureMessage: `Failed to stop ${name}`,
              initialMessage: `Stopping ${name}…`,
            },
          });
          const finishedAt = yield* Clock.currentTimeMillis;
          const elapsedSeconds = Math.max(
            0,
            Math.round((finishedAt - startedAt) / 1000)
          );
          yield* Console.log(`✔ Stopped ${name} in ${elapsedSeconds}s`);
        })
      )
    )
).pipe(
  Command.withDescription("Stop a running Lima VM without deleting it"),
  Command.withExamples([
    {
      command: "weave stop dev",
    },
  ])
);
