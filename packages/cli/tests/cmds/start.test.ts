import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";

import { limaNetworkArguments } from "../../src/lib/vm-network";
import { makeCliHarness } from "../helpers/cli";

describe("start", () => {
  it.effect("starts a stopped VM without changing its virtual disk", () =>
    Effect.gen(function* stoppedVmTest() {
      const harness = makeCliHarness({
        existingVm: true,
        processOutputs: ["Stopped"],
      });

      yield* harness.run(["start", "dev", "--ttl", "1h"]);

      expect(harness.calls).toEqual([
        {
          acceptableExitCodes: undefined,
          args: ["edit", "--tty=false", ...limaNetworkArguments([]), "dev"],
          progress: {
            failureMessage: "Failed to update port restrictions for dev",
            initialMessage: "Updating port restrictions for dev…",
          },
        },
        {
          acceptableExitCodes: undefined,
          args: ["start", "--tty=false", "--progress", "--mount-none", "dev"],
          progress: {
            failureMessage: "Failed to start dev",
            initialMessage: "Starting dev…",
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
            "--on-active=3600s",
            "--timer-property=AccuracySec=1s",
            "--collect",
            "systemctl",
            "poweroff",
          ],
          progress: undefined,
        },
      ]);
      expect(harness.stdout).toEqual(["✔ Started dev in 0s (TTL: 1h)"]);
      expect(harness.stderr).toEqual([]);
      expect(harness.fileWrites).toEqual([
        {
          contents: '{"expiresAt":3600000}',
          path: "/test/weave/lima-home/dev/.weave-ttl.json",
        },
      ]);
    })
  );

  it.effect("reports a missing VM without trying to start it", () =>
    Effect.gen(function* missingVmTest() {
      const harness = makeCliHarness();
      const error = yield* Effect.flip(harness.run(["start", "dev"]));

      expect(error).toMatchObject({
        _tag: "VmNotFoundError",
        name: "dev",
      });
      expect(error).toHaveProperty(
        "message",
        'VM "dev" does not exist. Create it with "weave create dev".'
      );
      expect(harness.calls).toEqual([]);
      expect(harness.processCalls).toEqual([]);
      expect(harness.fileWrites).toEqual([]);
      expect(harness.stdout).toEqual([]);
      expect(harness.stderr).toEqual([]);
    })
  );

  it.effect("reports an already-running VM without resetting its TTL", () =>
    Effect.gen(function* runningVmTest() {
      const harness = makeCliHarness({
        existingVm: true,
        processOutputs: ["Running"],
      });
      const error = yield* Effect.flip(harness.run(["start", "dev"]));

      expect(error).toMatchObject({
        _tag: "VmAlreadyRunningError",
        name: "dev",
      });
      expect(error).toHaveProperty("message", 'VM "dev" is already running.');
      expect(harness.calls).toEqual([]);
      expect(harness.processCalls).toHaveLength(1);
      expect(harness.fileWrites).toEqual([]);
      expect(harness.stdout).toEqual([]);
      expect(harness.stderr).toEqual([]);
    })
  );

  it.effect("starts a stopped VM with multiple selected mounts", () =>
    Effect.gen(function* mountedVmTest() {
      const harness = makeCliHarness({
        existingVm: true,
        mountPathTypes: {
          "./config": "Directory",
          "./src": "Directory",
        },
        processOutputs: ["Stopped"],
      });

      yield* harness.run(["start", "dev", "--mount", "./src", "./config:w"]);

      expect(harness.calls[1]?.args).toEqual([
        "start",
        "--tty=false",
        "--progress",
        "--mount-only=./src",
        "--mount-only=./config:w",
        "dev",
      ]);
      expect(harness.fileWrites).toHaveLength(1);
      expect(harness.stdout).toEqual(["✔ Started dev in 0s (TTL: 10m)"]);
      expect(harness.stderr).toEqual([]);
    })
  );

  it.effect("rejects mount paths without the mount flag", () =>
    Effect.gen(function* mountFlagRequiredTest() {
      const harness = makeCliHarness({ existingVm: true });
      const error = yield* Effect.flip(
        harness.run(["start", "dev", "./package.json"])
      );

      expect(error).toMatchObject({
        _tag: "InvalidMountArgumentsError",
        mountEnabled: false,
        paths: ["./package.json"],
      });
      expect(harness.calls).toEqual([]);
      expect(harness.processCalls).toEqual([]);
    })
  );

  it.effect("reports a broken VM as a lifecycle state error", () =>
    Effect.gen(function* brokenVmTest() {
      const harness = makeCliHarness({
        existingVm: true,
        processOutputs: ["Broken"],
      });
      const error = yield* Effect.flip(harness.run(["start", "dev"]));

      expect(error).toMatchObject({
        _tag: "VmLifecycleStateError",
        name: "dev",
        status: "Broken",
      });
      expect(error).toHaveProperty(
        "message",
        'VM "dev" cannot be started while its status is "Broken". Run "weave ls" for details, then repair or recreate the VM.'
      );
      expect(harness.calls).toEqual([]);
      expect(harness.fileWrites).toEqual([]);
      expect(harness.stdout).toEqual([]);
      expect(harness.stderr).toEqual([]);
    })
  );

  it.effect("reports an unknown VM status as a lifecycle state error", () =>
    Effect.gen(function* unknownVmTest() {
      const harness = makeCliHarness({
        existingVm: true,
        processOutputs: [""],
      });
      const error = yield* Effect.flip(harness.run(["start", "dev"]));

      expect(error).toMatchObject({
        _tag: "VmLifecycleStateError",
        name: "dev",
        status: "",
      });
      expect(error).toHaveProperty(
        "message",
        'VM "dev" cannot be started while its status is "Unknown". Run "weave ls" for details, then repair or recreate the VM.'
      );
      expect(harness.calls).toEqual([]);
      expect(harness.fileWrites).toEqual([]);
      expect(harness.stdout).toEqual([]);
      expect(harness.stderr).toEqual([]);
    })
  );

  it.effect("documents its TTL option in command help", () =>
    Effect.gen(function* startHelpTest() {
      const harness = makeCliHarness();

      yield* harness.run(["start", "--help"]);
      const help = harness.stdout.join("\n");

      expect(help).toContain("weave start [flags] <name>");
      expect(help).toContain("--mount");
      expect(help).toContain("--ttl");
      expect(help).toContain("Start a stopped VM with selected host mounts");
      expect(harness.stderr).toEqual([]);
    })
  );
});
