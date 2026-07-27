import { expect, it } from "@effect/vitest";
import { Effect, Exit } from "effect";

import { CliLifecycleError } from "../../src/schemas/errors/cli-lifecycle.schema";
import { makeCliHarness } from "../helpers/cli";

const runningVmList = {
  stderr: "",
  stdout:
    "NAME     STATUS   DIR\nalpha    Running  /tmp/alpha\npaused   Stopped  /tmp/paused\nbravo    Running  /tmp/bravo\n",
};

it.effect("stops every running managed VM before removing only the CLI", () =>
  Effect.gen(function* uninstallTest() {
    const harness = makeCliHarness({
      lifecycle: {
        uninstallResult: {
          deferred: false,
          path: "/usr/local/bin/weave",
        },
      },
      limaOutputs: [runningVmList],
      managedState: true,
    });

    yield* harness.run(["uninstall"]);

    expect(harness.calls).toEqual([
      { args: ["list"], captured: true },
      {
        acceptableExitCodes: undefined,
        args: ["stop", "--tty=false", "alpha"],
        progress: {
          failureMessage: "Failed to stop alpha",
          initialMessage: "Stopping alpha…",
        },
      },
      {
        acceptableExitCodes: undefined,
        args: ["stop", "--tty=false", "bravo"],
        progress: {
          failureMessage: "Failed to stop bravo",
          initialMessage: "Stopping bravo…",
        },
      },
    ]);
    expect(harness.lifecycleCalls).toEqual(["uninstall"]);
    expect(harness.stdout).toContain(
      "Retained runtime, configuration, VM disks, and user data in /test/weave"
    );
    expect(harness.stdout.join("\n")).toContain(
      "No persistent data was deleted"
    );
  })
);

it.effect("keeps the CLI installed when any running VM fails to stop", () =>
  Effect.gen(function* shutdownFailureTest() {
    const harness = makeCliHarness({
      limaOutputs: [runningVmList],
      limaRunFailures: ["bravo"],
      managedState: true,
    });

    const exit = yield* Effect.exit(harness.run(["uninstall"]));

    expect(Exit.isFailure(exit)).toBe(true);
    expect(harness.lifecycleCalls).toEqual([]);
    expect(harness.stdout).toContain("✔ Stopped alpha");
    expect(harness.stderr.join("\n")).toContain("Failed to stop bravo");
    expect(harness.stderr.join("\n")).toContain("The CLI was not removed");
  })
);

it.effect(
  "does not initialize Lima when no managed state directory exists",
  () =>
    Effect.gen(function* noStateTest() {
      const harness = makeCliHarness();

      yield* harness.run(["uninstall"]);

      expect(harness.calls).toEqual([]);
      expect(harness.lifecycleCalls).toEqual(["uninstall"]);
      expect(harness.stdout).toContain("No Weave-managed VM state found");
    })
);

it.effect("reports deferred Windows removal and its recovery log", () =>
  Effect.gen(function* deferredRemovalTest() {
    const harness = makeCliHarness({
      lifecycle: {
        uninstallResult: {
          deferred: true,
          path: "C:\\Users\\dev\\.local\\bin\\weave.exe",
          recoveryLog: "C:\\Temp\\weave-lifecycle.cmd.error.log",
        },
      },
    });

    yield* harness.run(["uninstall"]);

    expect(harness.stdout.join("\n")).toContain(
      "✔ Scheduled removal of Weave CLI from C:\\Users\\dev\\.local\\bin\\weave.exe"
    );
    expect(harness.stdout.join("\n")).toContain(
      "Windows will remove the executable after this process exits"
    );
    expect(harness.stdout.join("\n")).toContain(
      "C:\\Temp\\weave-lifecycle.cmd.error.log"
    );
  })
);

it.effect("reports a privileged removal failure and recovery action", () =>
  Effect.gen(function* removalFailureTest() {
    const harness = makeCliHarness({
      lifecycle: {
        uninstallError: new CliLifecycleError({
          detail: "administrator command exited with code 1",
          phase: "removal",
          recovery:
            "VMs and data were retained. The CLI remains at /usr/local/bin/weave.",
        }),
      },
      limaOutputs: [{ stderr: "", stdout: "" }],
    });

    const exit = yield* Effect.exit(harness.run(["uninstall"]));

    expect(Exit.isFailure(exit)).toBe(true);
    expect(harness.stderr).toEqual([
      "✖ Uninstall failed during removal: administrator command exited with code 1",
      "Recovery: VMs and data were retained. The CLI remains at /usr/local/bin/weave.",
    ]);
  })
);
