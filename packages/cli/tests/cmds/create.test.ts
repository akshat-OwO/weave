import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";

import { makeCliHarness } from "../helpers/cli";

describe("create", () => {
  it.effect("creates a Firecracker VM with default settings", () =>
    Effect.gen(function* createDefaultTest() {
      const harness = makeCliHarness();

      yield* harness.run(["create", "dev"]);

      expect(harness.calls).toHaveLength(1);
      expect(harness.calls[0]).toMatchObject({
        method: "create",
        request: {
          memoryMiB: 2048,
          name: "dev",
          ttl: { seconds: 600, value: "10m" },
        },
      });
      const [call] = harness.calls;
      expect(
        call?.method === "create" && call.request.cpuCount
      ).toBeGreaterThan(0);
      expect(harness.stdout).toEqual(["✔ Created dev in 0s (TTL: 10m)"]);
      expect(harness.stderr).toEqual([]);
    })
  );

  it.effect("passes every Firecracker create flag", () =>
    Effect.gen(function* createFlagsTest() {
      const harness = makeCliHarness();

      yield* harness.run([
        "create",
        "dev",
        "--cpus",
        "4",
        "--memory",
        "6",
        "--ttl",
        "2h",
        "--template",
        "node",
      ]);

      expect(harness.calls).toEqual([
        {
          method: "create",
          request: {
            cpuCount: 4,
            memoryMiB: 6144,
            name: "dev",
            template: "node",
            ttl: { seconds: 7200, value: "2h" },
          },
        },
      ]);
      expect(harness.stdout).toEqual(["✔ Created dev in 0s (TTL: 2h)"]);
    })
  );

  it.effect("reports a stopped VM as started", () =>
    Effect.gen(function* restartTest() {
      const harness = makeCliHarness({ createAction: "Started" });

      yield* harness.run([
        "create",
        "dev",
        "--cpus=6",
        "--memory=3",
        "--ttl=30s",
      ]);

      expect(harness.calls).toEqual([
        {
          method: "create",
          request: {
            cpuCount: 6,
            memoryMiB: 3072,
            name: "dev",
            template: undefined,
            ttl: { seconds: 30, value: "30s" },
          },
        },
      ]);
      expect(harness.stdout).toEqual(["✔ Started dev in 0s (TTL: 30s)"]);
    })
  );

  it.effect("rejects invalid CPU, memory, TTL, and VM name values", () =>
    Effect.gen(function* invalidCreateValuesTest() {
      for (const [args, validationMessage] of [
        [
          ["create", "dev", "--cpus", "0"],
          "CPU count must be greater than zero",
        ],
        [
          ["create", "dev", "--memory", "0"],
          "Memory must be greater than zero",
        ],
        [["create", "dev", "--memory", "1.5"], "Expected an integer"],
        [["create", "dev", "--ttl", "0m"], "TTL must be a positive duration"],
        [["create", "../dev"], "VM name must start with a letter or number"],
      ] as const) {
        const harness = makeCliHarness();
        const error = yield* Effect.flip(harness.run(args));

        expect(error).toMatchObject({ _tag: "ShowHelp" });
        expect(harness.calls).toEqual([]);
        expect(harness.stdout).toHaveLength(1);
        expect(harness.stdout[0]).toContain("weave create [flags] <name>");
        expect(harness.stderr[0]).toContain(validationMessage);
      }
    })
  );
});
