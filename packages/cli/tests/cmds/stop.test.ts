import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { makeCliHarness } from "../helpers/cli";

it.effect("stop stops the named VM without deleting it", () =>
  Effect.gen(function* stopTest() {
    const harness = makeCliHarness();

    yield* harness.run(["stop", "dev"]);

    expect(harness.calls).toEqual([
      {
        method: "stop",
        name: "dev",
      },
    ]);
    expect(harness.stdout).toEqual(["✔ Stopped dev in 0s"]);
    expect(harness.stderr).toEqual([]);
  })
);
