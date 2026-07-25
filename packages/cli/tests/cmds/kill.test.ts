import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { makeCliHarness } from "../helpers/cli";

it.effect("kill permanently deletes the named VM", () =>
  Effect.gen(function* killTest() {
    const harness = makeCliHarness();

    yield* harness.run(["kill", "dev"]);

    expect(harness.calls).toEqual([
      {
        acceptableExitCodes: undefined,
        args: ["delete", "--force", "--tty=false", "dev"],
      },
    ]);
  })
);
