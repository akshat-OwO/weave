import path from "node:path";

import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { TestClock } from "effect/testing";
import { describe } from "vitest";

import { VM_BASE_PREFIX } from "../../src/lib/vm-base-cache";
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

      expect(harness.calls).toHaveLength(5);
      const baseName = harness.calls[0]?.args
        .find((argument) => argument.startsWith("--name="))
        ?.slice("--name=".length);
      expect(baseName?.startsWith(VM_BASE_PREFIX)).toBe(true);
      expect(harness.calls[0]?.args).toEqual(
        expect.arrayContaining([
          "start",
          "--tty=false",
          "--progress",
          "--memory=2",
          "--mount-none",
        ])
      );
      expect(harness.calls[0]?.progress).toEqual({
        failureMessage: "Failed to prepare cached environment",
        initialMessage: "Preparing cached environment…",
        startedAt: 0,
      });
      expect(
        harness.calls.slice(0, 4).map(({ progress }) => progress?.startedAt)
      ).toEqual([0, 0, 0, 0]);
      expect(
        harness.calls[0]?.args.some((arg) => arg.startsWith("--cpus="))
      ).toBe(true);
      expect(harness.calls[1]?.args).toEqual(["stop", "--tty=false", baseName]);
      expect(harness.calls[2]?.args).toEqual(
        expect.arrayContaining([
          "clone",
          "--tty=false",
          "--memory=2",
          "--mount-none",
          baseName,
          "dev",
        ])
      );
      expect(harness.calls[3]?.args).toEqual([
        "start",
        "--tty=false",
        "--progress",
        "dev",
      ]);
      expect(harness.calls[4]?.args).toEqual([
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
      expect(harness.fileWrites).toContainEqual({
        contents: '{"expiresAt":600000}',
        path: "/test/weave/lima-home/dev/.weave-ttl.json",
      });
    })
  );

  it.effect("applies every create flag", () =>
    Effect.gen(function* createFlagsTest() {
      const harness = makeCliHarness({
        mountPathTypes: {
          "./config": "Directory",
          "./src": "Directory",
        },
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
        "--mount",
        "./src",
        "./config",
      ]);

      const baseName = harness.calls[0]?.args
        .find((argument) => argument.startsWith("--name="))
        ?.slice("--name=".length);
      expect(baseName?.startsWith(VM_BASE_PREFIX)).toBe(true);
      expect(harness.calls[0]?.args).toEqual(
        expect.arrayContaining([
          "--cpus=4",
          "--memory=2",
          "--mount-none",
          "/test/weave/templates/node.yaml",
        ])
      );
      expect(harness.calls[2]?.args).toEqual(
        expect.arrayContaining([
          "clone",
          "--cpus=4",
          "--memory=6",
          "--mount-only=./src",
          "--mount-only=./config",
          baseName,
          "dev",
        ])
      );
      expect(harness.calls[4]?.args).toContain("--on-active=7200s");
      expect(harness.stdout).toEqual(["✔ Created dev in 0s (TTL: 2h)"]);
      expect(harness.stderr).toEqual([]);
    })
  );

  it.effect("reuses a compatible base until its three-day expiry", () =>
    Effect.gen(function* reuseBaseTest() {
      const harness = makeCliHarness({
        processOutputs: [
          ...supportedNestedVirtualizationOutputs,
          ...supportedNestedVirtualizationOutputs,
        ],
      });

      yield* harness.run(["create", "first"]);
      const baseName = harness.calls[0]?.args
        .find((argument) => argument.startsWith("--name="))
        ?.slice("--name=".length);
      const firstCallCount = harness.calls.length;

      yield* TestClock.adjust("2 days");
      yield* harness.run(["create", "second"]);

      const reuseCalls = harness.calls.slice(firstCallCount);
      expect(reuseCalls).toHaveLength(3);
      expect(reuseCalls[0]?.args).toEqual(
        expect.arrayContaining(["clone", baseName, "second"])
      );
      expect(
        reuseCalls.some(({ args }) =>
          args.some((argument) => argument.startsWith("--name="))
        )
      ).toBe(false);
    })
  );

  it.effect("rebuilds and replaces a base after three days", () =>
    Effect.gen(function* staleBaseTest() {
      const harness = makeCliHarness({
        processOutputs: [
          ...supportedNestedVirtualizationOutputs,
          ...supportedNestedVirtualizationOutputs,
        ],
      });

      yield* harness.run(["create", "first"]);
      const oldBaseName = harness.calls[0]?.args
        .find((argument) => argument.startsWith("--name="))
        ?.slice("--name=".length);
      const firstCallCount = harness.calls.length;

      yield* TestClock.adjust("3 days");
      yield* harness.run(["create", "second"]);

      const refreshCalls = harness.calls.slice(firstCallCount);
      const newBaseName = refreshCalls[0]?.args
        .find((argument) => argument.startsWith("--name="))
        ?.slice("--name=".length);
      expect(newBaseName?.startsWith(VM_BASE_PREFIX)).toBe(true);
      expect(newBaseName).not.toBe(oldBaseName);
      expect(refreshCalls[2]?.args).toEqual([
        "delete",
        "--force",
        "--tty=false",
        oldBaseName,
      ]);
      const progressStartedAt = refreshCalls[0]?.progress?.startedAt;
      expect(
        refreshCalls.slice(0, 5).map(({ progress }) => progress?.startedAt)
      ).toEqual(Array.from({ length: 5 }, () => progressStartedAt));
      expect(refreshCalls[3]?.args).toEqual(
        expect.arrayContaining(["clone", newBaseName, "second"])
      );
      const metadataWrites = harness.fileWrites.filter(({ path: filePath }) =>
        filePath.includes("/cache/vm-bases/")
      );
      expect(JSON.parse(metadataWrites.at(-1)?.contents ?? "{}")).toMatchObject(
        {
          retiredNames: [],
        }
      );
    })
  );

  it.effect("retains failed base cleanups as internal metadata", () =>
    Effect.gen(function* failedBaseCleanupTest() {
      const cleanupFailures: string[] = [];
      const harness = makeCliHarness({
        limaRunFailures: cleanupFailures,
        processOutputs: [
          ...supportedNestedVirtualizationOutputs,
          ...supportedNestedVirtualizationOutputs,
        ],
      });

      yield* harness.run(["create", "first"]);
      const oldBaseName = harness.calls[0]?.args
        .find((argument) => argument.startsWith("--name="))
        ?.slice("--name=".length);
      expect(oldBaseName).toBeDefined();
      cleanupFailures.push(oldBaseName ?? "");

      yield* TestClock.adjust("3 days");
      yield* harness.run(["create", "second"]);

      const metadataWrites = harness.fileWrites.filter(({ path: filePath }) =>
        filePath.includes("/cache/vm-bases/")
      );
      expect(JSON.parse(metadataWrites.at(-1)?.contents ?? "{}")).toMatchObject(
        {
          retiredNames: [oldBaseName],
        }
      );
    })
  );

  it.effect("uses cold creation for custom templates", () =>
    Effect.gen(function* customTemplateTest() {
      const customTemplate = path.resolve("./custom.yaml");
      const harness = makeCliHarness({
        mountPathTypes: { [customTemplate]: "File" },
        processOutputs: supportedNestedVirtualizationOutputs,
      });

      yield* harness.run(["create", "dev", "--template", customTemplate]);

      expect(harness.calls).toHaveLength(2);
      expect(harness.calls[0]?.args).toEqual(
        expect.arrayContaining(["start", "--name=dev", customTemplate])
      );
      expect(harness.calls[0]?.args).not.toContain("clone");
    })
  );

  it.effect("bypasses the base cache when fresh creation is requested", () =>
    Effect.gen(function* freshCreateTest() {
      const harness = makeCliHarness({
        processOutputs: supportedNestedVirtualizationOutputs,
      });

      yield* harness.run(["create", "dev", "--template", "node", "--fresh"]);

      expect(harness.calls).toHaveLength(2);
      expect(harness.calls[0]?.args).toEqual(
        expect.arrayContaining([
          "start",
          "--tty=false",
          "--progress",
          "--name=dev",
          "--memory=2",
          "/test/weave/templates/node.yaml",
        ])
      );
      expect(harness.calls[0]?.args).not.toContain("clone");
      expect(
        harness.calls[0]?.args.some((argument) =>
          argument.startsWith(`--name=${VM_BASE_PREFIX}`)
        )
      ).toBe(false);
    })
  );

  it.effect("replaces mounts when restarting a stopped VM", () =>
    Effect.gen(function* restartWithMountsTest() {
      const harness = makeCliHarness({
        existingVm: true,
        mountPathTypes: {
          "./config": "Directory",
          "./src": "Directory",
        },
        processOutputs: ["Stopped"],
      });

      yield* harness.run(["create", "dev", "--mount", "./src", "./config:w"]);

      expect(harness.calls[0]?.args).toEqual([
        "edit",
        "--tty=false",
        "--mount-only=./src",
        "--mount-only=./config:w",
        "dev",
      ]);
    })
  );

  it.effect("rejects files and missing mount directories", () =>
    Effect.gen(function* invalidMountPathTest() {
      for (const [mountPath, type, reason] of [
        ["./package.json", "File", "expected a directory"],
        ["./missing", undefined, "directory does not exist"],
      ] as const) {
        const harness = makeCliHarness({
          mountPathTypes: { [mountPath]: type },
        });
        const error = yield* Effect.flip(
          harness.run(["create", "dev", "--mount", mountPath])
        );

        expect(error).toMatchObject({
          _tag: "InvalidMountPathError",
          path: mountPath,
          reason,
        });
        expect(harness.calls).toEqual([]);
      }
    })
  );

  it.effect("rejects mount paths without the mount flag", () =>
    Effect.gen(function* mountFlagRequiredTest() {
      const harness = makeCliHarness();
      const error = yield* Effect.flip(
        harness.run(["create", "dev", "./package.json"])
      );

      expect(error).toMatchObject({
        _tag: "InvalidMountArgumentsError",
        mountEnabled: false,
        paths: ["./package.json"],
      });
      expect(harness.calls).toEqual([]);
    })
  );

  it.effect("rejects the mount flag without paths", () =>
    Effect.gen(function* mountPathsRequiredTest() {
      const harness = makeCliHarness();
      const error = yield* Effect.flip(
        harness.run(["create", "dev", "--mount"])
      );

      expect(error).toMatchObject({
        _tag: "InvalidMountArgumentsError",
        mountEnabled: true,
        paths: [],
      });
      expect(harness.calls).toEqual([]);
    })
  );

  it.effect("rejects multiple mount flags", () =>
    Effect.gen(function* multipleMountFlagsTest() {
      const harness = makeCliHarness();
      const error = yield* Effect.flip(
        harness.run([
          "create",
          "dev",
          "--mount",
          "./src",
          "--mount",
          "./package.json",
        ])
      );

      expect(error).toMatchObject({ _tag: "ShowHelp" });
      expect(harness.calls).toEqual([]);
    })
  );

  it.effect("honors a false mount flag", () =>
    Effect.gen(function* falseMountFlagTest() {
      const harness = makeCliHarness({
        processOutputs: supportedNestedVirtualizationOutputs,
      });

      yield* harness.run(["create", "dev", "--no-mount"]);

      expect(harness.calls[0]?.args).toContain("--mount-none");

      const invalidHarness = makeCliHarness();
      const error = yield* Effect.flip(
        invalidHarness.run(["create", "dev", "--mount=false", "./src"])
      );

      expect(error).toMatchObject({
        _tag: "InvalidMountArgumentsError",
        mountEnabled: false,
        paths: ["./src"],
      });
      expect(invalidHarness.calls).toEqual([]);
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
          args: ["start", "--tty=false", "--progress", "dev"],
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
