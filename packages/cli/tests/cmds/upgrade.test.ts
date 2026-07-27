import { expect, it } from "@effect/vitest";
import { Effect, Exit } from "effect";

import cliPackage from "../../package.json" with { type: "json" };
import { CliLifecycleError } from "../../src/schemas/errors/cli-lifecycle.schema";
import { makeCliHarness } from "../helpers/cli";

it.effect("upgrades the installed CLI and reports the replacement path", () =>
  Effect.gen(function* upgradeTest() {
    const harness = makeCliHarness({
      lifecycle: {
        upgradeResult: {
          _tag: "Upgraded",
          deferred: false,
          fromVersion: cliPackage.version,
          path: "/opt/weave/bin/weave",
          toVersion: "0.0.2",
        },
      },
    });

    yield* harness.run(["upgrade"]);

    expect(harness.lifecycleCalls).toEqual([`upgrade:${cliPackage.version}`]);
    expect(harness.stdout).toEqual([
      `Checking for a compatible update (installed ${cliPackage.version})…`,
      `✔ Upgraded Weave ${cliPackage.version} → 0.0.2`,
      "Installed atomically at /opt/weave/bin/weave",
    ]);
    expect(harness.stderr).toEqual([]);
  })
);

it.effect("reports a deferred Windows replacement and its recovery log", () =>
  Effect.gen(function* deferredUpgradeTest() {
    const harness = makeCliHarness({
      lifecycle: {
        upgradeResult: {
          _tag: "Upgraded",
          deferred: true,
          fromVersion: cliPackage.version,
          path: "C:\\Users\\dev\\.local\\bin\\weave.exe",
          recoveryLog: "C:\\Temp\\weave-lifecycle.cmd.error.log",
          toVersion: "0.1.0",
        },
      },
    });

    yield* harness.run(["upgrade"]);

    expect(harness.stdout.join("\n")).toContain(
      `✔ Scheduled Weave ${cliPackage.version} → 0.1.0`
    );
    expect(harness.stdout.join("\n")).toContain(
      "Windows will replace C:\\Users\\dev\\.local\\bin\\weave.exe atomically after this process exits"
    );
    expect(harness.stdout.join("\n")).toContain(
      "C:\\Temp\\weave-lifecycle.cmd.error.log"
    );
  })
);

it.effect("clearly no-ops when the installed CLI is current", () =>
  Effect.gen(function* currentTest() {
    const harness = makeCliHarness();

    yield* harness.run(["upgrade"]);

    expect(harness.stdout).toContain(
      `✔ Weave ${cliPackage.version} is already up to date`
    );
  })
);

it.effect("reports network failures and confirms the binary is retained", () =>
  Effect.gen(function* networkFailureTest() {
    const harness = makeCliHarness({
      lifecycle: {
        upgradeError: new CliLifecycleError({
          detail: "network unavailable",
          phase: "release-check",
          recovery:
            "The installed binary was not changed. Check the network and retry.",
        }),
      },
    });

    const exit = yield* Effect.exit(harness.run(["upgrade"]));

    expect(Exit.isFailure(exit)).toBe(true);
    expect(harness.stderr).toEqual([
      "✖ Upgrade failed during release-check: network unavailable",
      "Recovery: The installed binary was not changed. Check the network and retry.",
    ]);
  })
);

it.effect("reports replacement failures without claiming success", () =>
  Effect.gen(function* replacementFailureTest() {
    const harness = makeCliHarness({
      lifecycle: {
        upgradeError: new CliLifecycleError({
          detail: "atomic rename failed",
          phase: "replacement",
          recovery: "The original binary at /usr/local/bin/weave is intact.",
        }),
      },
    });

    const exit = yield* Effect.exit(harness.run(["upgrade"]));

    expect(Exit.isFailure(exit)).toBe(true);
    expect(harness.stdout.join("\n")).not.toContain("Upgraded Weave");
    expect(harness.stderr.join("\n")).toContain(
      "The original binary at /usr/local/bin/weave is intact."
    );
  })
);
