import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { formatVmList } from "../../src/cmds/list";
import { makeCliHarness } from "../helpers/cli";

const runningVm = {
  backend: "native",
  cpuCount: 4,
  expiresAt: 65_000,
  memoryMiB: 2048,
  name: "dev",
  status: "Running",
} as const;

it.effect("ls and its list alias list Firecracker VMs", () =>
  Effect.gen(function* listTest() {
    for (const command of ["ls", "list"]) {
      const harness = makeCliHarness({ vms: [runningVm] });

      yield* harness.run([command]);

      expect(harness.calls).toEqual([{ method: "list" }]);
      expect(harness.stdout).toEqual([
        "NAME  STATUS   BACKEND  CPUS  MEMORY  TTL\n" +
          "dev   Running  native   4     2 GiB   1m 5s",
      ]);
    }
  })
);

it.effect("renders an empty Firecracker table", () =>
  Effect.gen(function* emptyListTest() {
    const harness = makeCliHarness();

    yield* harness.run(["ls"]);

    expect(harness.stdout).toEqual([
      "NAME  STATUS  BACKEND  CPUS  MEMORY  TTL",
    ]);
  })
);

it("formats stopped and expired TTL values", () => {
  expect(
    formatVmList(
      [
        { ...runningVm, expiresAt: 999, name: "expired" },
        { ...runningVm, name: "stopped", status: "Stopped" },
      ],
      1000
    )
  ).toBe(
    "NAME     STATUS   BACKEND  CPUS  MEMORY  TTL\n" +
      "expired  Running  native   4     2 GiB   expired\n" +
      "stopped  Stopped  native   4     2 GiB   -"
  );
});
