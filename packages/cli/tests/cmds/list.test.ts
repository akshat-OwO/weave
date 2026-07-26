import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { formatVmList } from "../../src/cmds/list";
import { makeCliHarness } from "../helpers/cli";

it.effect("ls and its list alias list VMs", () =>
  Effect.gen(function* listTest() {
    for (const command of ["ls", "list"]) {
      const harness = makeCliHarness({
        limaOutputs: [
          {
            stderr: "",
            stdout: "NAME  STATUS   DIR\nvm    Running  /tmp/vm\n",
          },
        ],
      });

      yield* harness.run([command]);

      expect(harness.calls).toEqual([{ args: ["list"], captured: true }]);
      expect(harness.stdout).toEqual([
        "NAME  STATUS   TTL     DIR\nvm    Running  -       /tmp/vm",
      ]);
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
        "NAME\tSTATUS\tSSH\tVMTYPE\tARCH\tCPUS\tMEMORY\tDISK\tTTL     DIR",
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
      "NAME\tSTATUS\tSSH\tVMTYPE\tARCH\tCPUS\tMEMORY\tDISK\tTTL     DIR",
    ]);
    expect(harness.stderr).toEqual([otherWarning]);
  })
);

it.effect("shows the remaining TTL for running VMs", () =>
  Effect.gen(function* ttlListTest() {
    const harness = makeCliHarness({
      limaOutputs: [
        {
          stderr: "",
          stdout:
            "NAME     STATUS   DIR\nrunning  Running  /tmp/running\nstopped  Stopped  /tmp/stopped\n",
        },
      ],
      ttlExpiresAtByVm: {
        running: 65_000,
        stopped: 65_000,
      },
    });

    yield* harness.run(["list"]);

    expect(harness.stdout).toEqual([
      "NAME     STATUS   TTL     DIR\nrunning  Running  1m 5s   /tmp/running\nstopped  Stopped  -       /tmp/stopped",
    ]);
  })
);

it("formats expired and long TTL values", () => {
  expect(
    formatVmList(
      "NAME     STATUS   DIR\nexpired  Running  /tmp/expired\nlong     Running  /tmp/long\n",
      new Map([
        ["expired", 999],
        ["long", 93_784_000],
      ]),
      1000
    )
  ).toBe(
    "NAME     STATUS   TTL     DIR\nexpired  Running  expired /tmp/expired\nlong     Running  1d 2h   /tmp/long"
  );
});
