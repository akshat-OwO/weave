import { Command } from "effect/unstable/cli";

import { create } from "./create";
import { kill } from "./kill";
import { list } from "./list";
import { shell } from "./shell";
import { ssh } from "./ssh";
import { start } from "./start";
import { stop } from "./stop";

export const weave = Command.make("weave").pipe(
  Command.withDescription("Create and manage sandboxed Lima VMs"),
  Command.withSubcommands([create, start, list, stop, kill, shell, ssh])
);
