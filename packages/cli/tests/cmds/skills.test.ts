import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";

import { skillNames, skillSections } from "../../src/skill-content";
import { makeCliHarness } from "../helpers/cli";

const makeSkillHarness = (skillName: (typeof skillNames)[number]) =>
  Effect.gen(function* makeSkillHarnessHandler() {
    const content = yield* Effect.promise(() =>
      Bun.file(skillSections[skillName].asset).text()
    );
    return {
      content,
      harness: makeCliHarness({
        fileContents: { [skillSections[skillName].asset]: content },
      }),
    };
  });

describe("skills", () => {
  it.effect("lists every embedded skill section", () =>
    Effect.gen(function* listSkillsTest() {
      const harness = makeCliHarness();

      yield* harness.run(["skills", "list"]);

      const output = harness.stdout.join("\n");
      for (const skillName of skillNames) {
        expect(output).toContain(
          `${skillName}\t${skillSections[skillName].description}`
        );
      }
      expect(harness.stderr).toEqual([]);
    })
  );

  it.effect("prints the requested version-matched section", () =>
    Effect.gen(function* getSkillTest() {
      const { content, harness } = yield* makeSkillHarness("copy");

      yield* harness.run(["skills", "get", "copy"]);

      expect(harness.stdout).toEqual([content]);
      expect(harness.stderr).toEqual([]);
    })
  );

  it.effect("explains restricted network access and port publishing", () =>
    Effect.gen(function* networkSkillTest() {
      const { harness } = yield* makeSkillHarness("network");

      yield* harness.run(["skills", "get", "network"]);

      const output = harness.stdout.join("\n");
      expect(output).toContain("weave port add");
      expect(output).toContain("127.0.0.1");
      expect(output).toContain("outbound DNS and internet access");
      expect(output).toContain("briefly restarts");
      expect(output).toContain("--retry-connrefused");
      expect(harness.stderr).toEqual([]);
    })
  );

  it.effect("rejects unknown skill sections", () =>
    Effect.gen(function* unknownSkillTest() {
      const harness = makeCliHarness();

      const error = yield* Effect.flip(
        harness.run(["skills", "get", "unknown"])
      );

      expect(error).toBeDefined();
      expect(harness.stdout.join("\n")).not.toContain("# Weave");
    })
  );
});
