import { expect, it } from "@effect/vitest";
import { Cause, Effect } from "effect";
import { TestConsole } from "effect/testing";

import {
  CliLogger,
  formatCause,
  makeCliLogger,
} from "../../src/services/cli-logger";

it("formats failures without stack traces by default", () => {
  const cause = Cause.die("Command exited with code 1");

  expect(formatCause(cause, false)).toBe("✖ Command exited with code 1");
});

it("includes stack traces and file paths in debug mode", () => {
  const error = new Error("Command exited with code 1");
  error.stack =
    "Error: Command exited with code 1\n    at run (/workspace/src/index.ts:10:2)";

  const output = formatCause(Cause.die(error), true);

  expect(output).toContain("Error: Command exited with code 1");
  expect(output).toContain("/workspace/src/index.ts:10:2");
});

it.effect(
  "suppresses raw diagnostics and writes formatted failures by default",
  () =>
    Effect.gen(function* cliLoggerTest() {
      const logger = yield* CliLogger;

      yield* logger.logDebug(
        'time="2026-07-29T18:08:18+05:30" level=warning msg="No instance found"'
      );
      yield* logger.logCause(Cause.fail(new Error("VM not found")));

      expect(yield* TestConsole.errorLines).toEqual(["✖ VM not found"]);
    }).pipe(Effect.provideService(CliLogger, makeCliLogger(false)))
);

it.effect("writes raw diagnostics in debug mode", () =>
  Effect.gen(function* debugLoggerTest() {
    const logger = yield* CliLogger;

    yield* logger.logDebug("raw Lima warning");

    expect(yield* TestConsole.errorLines).toEqual(["raw Lima warning"]);
  }).pipe(Effect.provideService(CliLogger, makeCliLogger(true)))
);
