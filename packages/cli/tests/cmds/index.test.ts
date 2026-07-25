import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { makeCliHarness } from "../helpers/cli";

it.effect("exposes help, version, every command, and the list alias", () =>
  Effect.gen(function* commandMetadataTest() {
    const versionHarness = makeCliHarness();
    yield* versionHarness.run(["--version"]);
    expect(versionHarness.stdout).toContain("weave v0.0.0");
    expect(versionHarness.stderr).toEqual([]);

    const helpHarness = makeCliHarness();
    yield* helpHarness.run(["--help"]);
    const help = helpHarness.stdout.join("\n");

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
    expect(helpHarness.stderr).toEqual([]);
  })
);
