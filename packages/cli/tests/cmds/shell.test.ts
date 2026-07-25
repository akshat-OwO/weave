import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { makeCliHarness } from "../helpers/cli";

it.effect(
  "shell executes the exact command through the guest login shell",
  () =>
    Effect.gen(function* shellTest() {
      const harness = makeCliHarness();

      yield* harness.run(["shell", "dev", "printf 'hello world'"]);

      expect(harness.calls).toEqual([
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
    })
);
