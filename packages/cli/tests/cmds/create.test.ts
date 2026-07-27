import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";

import { makeCliHarness } from "../helpers/cli";

const supportedNestedVirtualizationOutputs =
  process.platform === "darwin" && process.arch === "arm64"
    ? ["Apple M3", "15.0"]
    : [];

describe("create", () => {
  it.effect("creates a VM with default CPU, memory, and TTL settings", () =>
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
          "--memory=2",
          "--mount-none",
        ])
      );
      expect(harness.calls[0]?.progress).toEqual({
        failureMessage: "Failed to start virtual machine",
        initialMessage: "Starting virtual machine…",
      });
      expect(
        harness.calls[0]?.args.some((arg) => arg.startsWith("--cpus="))
      ).toBe(true);
      expect(harness.calls[1]?.args).toEqual([
        "shell",
        "dev",
        "--",
        "sudo",
        "systemd-run",
        "--quiet",
        "--unit=weave-ttl",
        "--on-active=600s",
        "--timer-property=AccuracySec=1s",
        "--collect",
        "systemctl",
        "poweroff",
      ]);
      expect(harness.stdout).toEqual(["✔ Created dev in 0s (TTL: 10m)"]);
      expect(harness.stderr).toEqual([]);
      expect(harness.fileWrites).toEqual([
        {
          contents: '{"expiresAt":600000}',
          path: "/test/weave/lima-home/dev/.weave-ttl.json",
        },
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
        "--memory",
        "6",
        "--ttl",
        "2h",
        "--template",
        "node",
      ]);

      expect(harness.calls[0]?.args).toEqual(
        expect.arrayContaining([
          "--cpus=4",
          "--memory=6",
          "--name=dev",
          "/test/weave/templates/node.yaml",
        ])
      );
      expect(harness.calls[1]?.args).toContain("--on-active=7200s");
      expect(harness.stdout).toEqual(["✔ Created dev in 0s (TTL: 2h)"]);
      expect(harness.stderr).toEqual([]);
    })
  );

  it.effect("restarts a stopped VM and updates its CPU and memory", () =>
    Effect.gen(function* restartTest() {
      const harness = makeCliHarness({
        existingVm: true,
        processOutputs: ["Stopped"],
      });

      yield* harness.run([
        "create",
        "dev",
        "--cpus=6",
        "--memory=3",
        "--ttl=30s",
      ]);

      expect(harness.calls).toEqual([
        {
          acceptableExitCodes: undefined,
          args: [
            "edit",
            "--tty=false",
            "--mount-none",
            "--cpus=6",
            "--memory=3",
            "dev",
          ],
          progress: {
            failureMessage: "Failed to update virtual machine configuration",
            initialMessage: "Updating virtual machine configuration…",
          },
        },
        {
          acceptableExitCodes: undefined,
          args: ["start", "--tty=false", "dev"],
          progress: {
            failureMessage: "Failed to start virtual machine",
            initialMessage: "Starting virtual machine…",
          },
        },
        {
          acceptableExitCodes: undefined,
          args: [
            "shell",
            "dev",
            "--",
            "sudo",
            "systemd-run",
            "--quiet",
            "--unit=weave-ttl",
            "--on-active=30s",
            "--timer-property=AccuracySec=1s",
            "--collect",
            "systemctl",
            "poweroff",
          ],
          progress: undefined,
        },
      ]);
      expect(harness.stdout).toEqual(["✔ Started dev in 0s (TTL: 30s)"]);
      expect(harness.stderr).toEqual([]);
      expect(harness.fileWrites).toEqual([
        {
          contents: '{"expiresAt":30000}',
          path: "/test/weave/lima-home/dev/.weave-ttl.json",
        },
      ]);
    })
  );

  it.effect("restarts a stopped VM with no configuration changes", () =>
    Effect.gen(function* restartWithoutChangesTest() {
      const harness = makeCliHarness({
        existingVm: true,
        processOutputs: ["Stopped"],
      });

      yield* harness.run(["create", "dev"]);

      expect(harness.calls[0]).toEqual({
        acceptableExitCodes: undefined,
        args: ["edit", "--tty=false", "--mount-none", "dev"],
        progress: {
          failureMessage: "Failed to update virtual machine configuration",
          initialMessage: "Updating virtual machine configuration…",
        },
      });
      expect(harness.stdout).toEqual(["✔ Started dev in 0s (TTL: 10m)"]);
      expect(harness.stderr).toEqual([]);
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
      expect(harness.stdout).toEqual([]);
      expect(harness.stderr).toEqual([]);
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
      expect(harness.stdout).toEqual([]);
      expect(harness.stderr).toEqual([]);
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
        expect(harness.stderr).toHaveLength(1);
        expect(harness.stderr[0]).toContain(validationMessage);
      }
    })
  );
});
