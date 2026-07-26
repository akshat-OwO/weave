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
          command: "printf 'hello world'",
          method: "shell",
          name: "dev",
        },
      ]);
      expect(harness.stdout).toEqual([]);
      expect(harness.stderr).toEqual([]);
    })
);
