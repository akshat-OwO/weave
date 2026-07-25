import { Console, Effect } from "effect";
import { Command } from "effect/unstable/cli";

import { LimaRuntime } from "../services/lima-runtime";

const emptyVmTable = "NAME\tSTATUS\tSSH\tVMTYPE\tARCH\tCPUS\tMEMORY\tDISK\tDIR";
const noInstancesWarning =
  "No instance found. Run `limactl create` to create an instance.";

export const formatVmList = (stdout: string): string =>
  stdout.trimEnd() || emptyVmTable;

export const formatVmListWarnings = (stderr: string): string =>
  stderr
    .split(/\r?\n/u)
    .filter((line) => !line.includes(noInstancesWarning))
    .join("\n")
    .trim();

export const list = Command.make("ls", {}, () =>
  Effect.gen(function* listHandler() {
    const lima = yield* LimaRuntime;
    const output = yield* lima.capture(["list"]);
    const warnings = formatVmListWarnings(output.stderr);

    if (warnings.length > 0) {
      yield* Console.error(warnings);
    }
    yield* Console.log(formatVmList(output.stdout));
  })
).pipe(
  Command.withAlias("list"),
  Command.withDescription("List running and stopped Lima VMs"),
  Command.withExamples([{ command: "weave ls" }])
);
