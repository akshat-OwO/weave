import { Command } from "effect/unstable/cli";

import { cp } from "./cp";
import { create } from "./create";
import { kill } from "./kill";
import { list } from "./list";
import { port } from "./port";
import { shell } from "./shell";
import { skills } from "./skills";
import { ssh } from "./ssh";
import { start } from "./start";
import { stop } from "./stop";
import { uninstall } from "./uninstall";
import { upgrade } from "./upgrade";

export const weave = Command.make("weave").pipe(
  Command.withDescription("Create and manage sandboxed Lima VMs"),
  Command.withSubcommands([
    create,
    cp,
    start,
    list,
    port,
    stop,
    kill,
    shell,
    ssh,
    skills,
    upgrade,
    uninstall,
  ])
);
