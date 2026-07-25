import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { makeCliHarness } from "../helpers/cli";

it.effect("ls and its list alias list VMs", () =>
  Effect.gen(function* listTest() {
    for (const command of ["ls", "list"]) {
      const harness = makeCliHarness({
        limaOutputs: [
          {
            stderr: "",
            stdout: "NAME STATUS\nvm Running\n",
          },
        ],
      });

      yield* harness.run([command]);

      expect(harness.calls).toEqual([{ args: ["list"], captured: true }]);
      expect(harness.stdout).toEqual(["NAME STATUS\nvm Running"]);
      expect(harness.stderr).toEqual([]);
    }
  })
);

it.effect(
  "renders an empty table and suppresses Lima's no-instance warning",
  () =>
    Effect.gen(function* emptyListTest() {
      const harness = makeCliHarness({
        limaOutputs: [
          {
            stderr:
              "WARN[0000] No instance found. Run `limactl create` to create an instance.\n",
            stdout: "",
          },
        ],
      });

      yield* harness.run(["ls"]);

      expect(harness.calls).toEqual([{ args: ["list"], captured: true }]);
      expect(harness.stdout).toEqual([
        "NAME\tSTATUS\tSSH\tVMTYPE\tARCH\tCPUS\tMEMORY\tDISK\tDIR",
      ]);
      expect(harness.stderr).toEqual([]);
    })
);

it.effect("preserves Lima warnings other than the no-instance warning", () =>
  Effect.gen(function* listWarningTest() {
    const otherWarning = 'WARN[0000] instance "dev" has errors';
    const harness = makeCliHarness({
      limaOutputs: [
        {
          stderr: `WARN[0000] No instance found. Run \`limactl create\` to create an instance.\n${otherWarning}\n`,
          stdout: "",
        },
      ],
    });

    yield* harness.run(["list"]);

    expect(harness.stdout).toEqual([
      "NAME\tSTATUS\tSSH\tVMTYPE\tARCH\tCPUS\tMEMORY\tDISK\tDIR",
    ]);
    expect(harness.stderr).toEqual([otherWarning]);
  })
);
