import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";

import {
  limaNetworkArguments,
  vmNetworkMetadataPath,
} from "../../src/lib/vm-network";
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
      const networkPath = vmNetworkMetadataPath("/test/weave/lima-home", "dev");
      const harness = makeCliHarness({
        fileContents: {
          [networkPath]: JSON.stringify({
            ports: [{ guestPort: 3000, hostPort: 8080 }],
            version: 1,
          }),
        },
        limaOutputs: [
          { stderr: "", stdout: "Stopped\n" },
          { stderr: "", stdout: "Stopped\n" },
        ],
      });

      yield* harness.run(["shell", "dev", "true"]);

      expect(harness.calls).toEqual([
        {
          args: ["list", "dev", "--format={{.Status}}"],
          captured: true,
        },
        {
          args: ["list", "dev", "--format={{.Status}}"],
          captured: true,
        },
        {
          acceptableExitCodes: undefined,
          args: [
            "edit",
            "--tty=false",
            ...limaNetworkArguments([{ guestPort: 3000, hostPort: 8080 }]),
            "dev",
          ],
          progress: {
            failureMessage: "Failed to update port restrictions for dev",
            initialMessage: "Updating port restrictions for dev…",
          },
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
