import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { TestConsole } from "effect/testing";

import { makeCliHarness } from "../helpers/cli";

it.effect("exposes help, version, every command, and the list alias", () =>
  Effect.gen(function* commandMetadataTest() {
    const versionHarness = makeCliHarness();
    yield* versionHarness.run(["--version"]);
    expect(yield* TestConsole.logLines).toContain("weave v0.0.0");

    const helpHarness = makeCliHarness();
    yield* helpHarness.run(["--help"]);
    const help = (yield* TestConsole.logLines).join("\n");

    for (const name of [
      "create",
      "ls",
      "list",
      "stop",
      "kill",
      "shell",
      "ssh",
    ]) {
      expect(help).toContain(name);
    }
  })
);
