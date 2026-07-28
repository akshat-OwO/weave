import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";

import { makeCliHarness } from "../helpers/cli";

describe("shell", () => {
  it.effect("executes the exact command through the guest login shell", () =>
    Effect.gen(function* shellTest() {
      const harness = makeCliHarness({
        limaOutputs: [{ stderr: "", stdout: "Running\n" }],
      });

      yield* harness.run(["shell", "dev", "printf 'hello world'"]);

      expect(harness.calls).toEqual([
        {
          args: ["list", "dev", "--format={{.Status}}"],
          captured: true,
        },
        {
          acceptableExitCodes: undefined,
          args: [
            "shell",
            "dev",
            "--",
            "sh",
            "-lc",
            'shell="$SHELL"; test -n "$shell" || shell=/bin/sh; exec "$shell" -lic "$1"',
            "weave-shell",
            "printf 'hello world'",
          ],
        },
      ]);
      expect(harness.stdout).toEqual([]);
      expect(harness.stderr).toEqual([]);
    })
  );

  it.effect("renders progress before executing a command in a stopped VM", () =>
    Effect.gen(function* stoppedShellTest() {
      const harness = makeCliHarness({
        limaOutputs: [{ stderr: "", stdout: "Stopped\n" }],
      });

      yield* harness.run(["shell", "dev", "true"]);

      expect(harness.calls).toEqual([
        {
          args: ["list", "dev", "--format={{.Status}}"],
          captured: true,
        },
        {
          acceptableExitCodes: undefined,
          args: ["start", "--tty=false", "--progress", "dev"],
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
            "sh",
            "-lc",
            'shell="$SHELL"; test -n "$shell" || shell=/bin/sh; exec "$shell" -lic "$1"',
            "weave-shell",
            "true",
          ],
        },
      ]);
    })
  );

  it.effect("does not execute the command when startup is declined", () =>
    Effect.gen(function* declinedShellTest() {
      const harness = makeCliHarness({
        confirmStart: false,
        limaOutputs: [{ stderr: "", stdout: "Stopped\n" }],
      });

      yield* harness.run(["shell", "dev", "true"]);

      expect(harness.calls).toEqual([
        {
          args: ["list", "dev", "--format={{.Status}}"],
          captured: true,
        },
      ]);
    })
  );
});
