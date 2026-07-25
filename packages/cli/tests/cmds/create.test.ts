import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";

import { makeCliHarness } from "../helpers/cli";

const supportedNestedVirtualizationOutputs =
  process.platform === "darwin" && process.arch === "arm64"
    ? ["Apple M3", "15.0"]
    : [];

describe("create", () => {
  it.effect("creates a VM with default CPU and TTL settings", () =>
    Effect.gen(function* createDefaultTest() {
      const harness = makeCliHarness({
        processOutputs: supportedNestedVirtualizationOutputs,
      });

      yield* harness.run(["create", "dev"]);

      expect(harness.calls).toHaveLength(2);
      expect(harness.calls[0]?.args).toEqual(
        expect.arrayContaining([
          "start",
          "--tty=false",
          "--name=dev",
          "--mount-none",
        ])
      );
      expect(
        harness.calls[0]?.args.some((arg) => arg.startsWith("--cpus="))
      ).toBe(true);
      expect(harness.calls[1]?.args).toEqual([
        "shell",
        "dev",
        "--",
        "sh",
        "-lc",
        "nohup sh -c 'sleep 600; sudo poweroff' >/dev/null 2>&1 </dev/null &",
      ]);
    })
  );

  it.effect("applies every create flag", () =>
    Effect.gen(function* createFlagsTest() {
      const harness = makeCliHarness({
        processOutputs: supportedNestedVirtualizationOutputs,
      });

      yield* harness.run([
        "create",
        "dev",
        "--cpus",
        "4",
        "--ttl",
        "2h",
        "--template",
        "node",
      ]);

      expect(harness.calls[0]?.args).toEqual(
        expect.arrayContaining([
          "--cpus=4",
          "--name=dev",
          "/test/weave/templates/node.yaml",
        ])
      );
      expect(harness.calls[1]?.args.at(-1)).toContain("sleep 7200");
    })
  );

  it.effect("restarts a stopped VM and updates its CPU count", () =>
    Effect.gen(function* restartTest() {
      const harness = makeCliHarness({
        existingVm: true,
        processOutputs: ["Stopped"],
      });

      yield* harness.run(["create", "dev", "--cpus=6", "--ttl=30s"]);

      expect(harness.calls).toEqual([
        {
          acceptableExitCodes: undefined,
          args: ["edit", "--tty=false", "--mount-none", "--cpus=6", "dev"],
        },
        {
          acceptableExitCodes: undefined,
          args: ["start", "--tty=false", "dev"],
        },
        {
          acceptableExitCodes: undefined,
          args: [
            "shell",
            "dev",
            "--",
            "sh",
            "-lc",
            "nohup sh -c 'sleep 30; sudo poweroff' >/dev/null 2>&1 </dev/null &",
          ],
        },
      ]);
    })
  );

  it.effect("rejects templates for an existing VM", () =>
    Effect.gen(function* existingTemplateTest() {
      const harness = makeCliHarness({ existingVm: true });
      const error = yield* Effect.flip(
        harness.run(["create", "dev", "--template", "python"])
      );

      expect(error).toMatchObject({
        _tag: "TemplateOnExistingVmError",
        name: "dev",
      });
      expect(harness.calls).toEqual([]);
    })
  );

  it.effect("rejects an existing VM unless it is stopped", () =>
    Effect.gen(function* existingRunningTest() {
      const harness = makeCliHarness({
        existingVm: true,
        processOutputs: ["Running"],
      });
      const error = yield* Effect.flip(harness.run(["create", "dev"]));

      expect(error).toMatchObject({
        _tag: "VmAlreadyExistsError",
        name: "dev",
      });
      expect(harness.calls).toEqual([]);
    })
  );

  it.effect("rejects invalid CPU, TTL, and VM name values", () =>
    Effect.gen(function* invalidCreateValuesTest() {
      for (const args of [
        ["create", "dev", "--cpus", "0"],
        ["create", "dev", "--ttl", "0m"],
        ["create", "../dev"],
      ]) {
        const harness = makeCliHarness();
        const error = yield* Effect.flip(harness.run(args));

        expect(error).toMatchObject({ _tag: "ShowHelp" });
        expect(harness.calls).toEqual([]);
      }
    })
  );
});
