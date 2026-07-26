import { Effect } from "effect";
import { Argument, Command } from "effect/unstable/cli";

import { VmName } from "../schemas/vm-name.schema";
import { VmManager } from "../services/vm-manager";

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
      const manager = yield* VmManager;
      yield* manager.ssh(name);
    })
).pipe(
  Command.withDescription("Open an interactive shell in a Firecracker VM"),
  Command.withExamples([{ command: "weave ssh dev" }])
);
