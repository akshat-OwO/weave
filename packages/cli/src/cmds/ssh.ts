import { Effect } from "effect";
import { Argument, Command } from "effect/unstable/cli";

import { ensureVmRunning } from "../lib/ensure-vm-running";
import { VmName } from "../schemas/vm-name.schema";
import { LimaRuntime } from "../services/lima-runtime";

const ACCEPTABLE_EXIT_CODES = [0, 100, 130] as const;

export const ssh = Command.make(
  "ssh",
  {
    name: Argument.string("name").pipe(
      Argument.withSchema(VmName),
      Argument.withDescription("Name of the running VM")
    ),
  },
  ({ name }) =>
    Effect.gen(function* sshHandler() {
      const lima = yield* LimaRuntime;
      yield* lima.assertIsolated(name);
      const isRunning = yield* ensureVmRunning(name);
      if (!isRunning) {
        return;
      }
      yield* lima.run(["shell", name], {
        acceptableExitCodes: ACCEPTABLE_EXIT_CODES,
      });
    })
).pipe(
  Command.withDescription("Open an interactive shell in a Lima VM"),
  Command.withExamples([
    {
      command: "weave ssh dev",
    },
  ])
);
