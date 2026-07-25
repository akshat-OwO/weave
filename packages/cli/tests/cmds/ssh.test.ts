import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { makeCliHarness } from "../helpers/cli";

it.effect(
  "ssh opens an interactive shell with expected terminal exit codes",
  () =>
    Effect.gen(function* sshTest() {
      const harness = makeCliHarness();

      yield* harness.run(["ssh", "dev"]);

      expect(harness.calls).toEqual([
        {
          acceptableExitCodes: [0, 100, 130],
          args: ["shell", "dev"],
        },
      ]);
      expect(harness.stdout).toEqual([]);
      expect(harness.stderr).toEqual([]);
    })
);
