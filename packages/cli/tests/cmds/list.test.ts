import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { makeCliHarness } from "../helpers/cli";

it.effect("ls and its list alias list VMs", () =>
  Effect.gen(function* listTest() {
    for (const command of ["ls", "list"]) {
      const harness = makeCliHarness();

      yield* harness.run([command]);

      expect(harness.calls).toEqual([
        { acceptableExitCodes: undefined, args: ["list"] },
      ]);
    }
  })
);
