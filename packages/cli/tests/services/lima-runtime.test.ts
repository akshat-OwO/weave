import { expect, it } from "@effect/vitest";
import { Cause, Effect, Exit, Sink, Stream, Terminal } from "effect";
import { TestConsole } from "effect/testing";
import type { ChildProcess } from "effect/unstable/process";
import { ChildProcessSpawner } from "effect/unstable/process";

import { CliLogger, makeCliLogger } from "../../src/services/cli-logger";
import { LimaRuntime, LimaRuntimeLive } from "../../src/services/lima-runtime";
import { UserConfig } from "../../src/services/user-config";

it.effect("hides Lima diagnostics while preserving guest stderr", () => {
  const commands: ChildProcess.Command[] = [];
  const encoder = new TextEncoder();
  const stderr = [
    '{"level":"warning","msg":"Configuration is deprecated"}',
    "guest process failed",
    '{"level":"fatal","msg":"Failed to open VM disk"}',
  ].join("\n");
  const handle = ChildProcessSpawner.makeHandle({
    all: Stream.empty,
    exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(1)),
    getInputFd: () => Sink.drain,
    getOutputFd: () => Stream.empty,
    isRunning: Effect.succeed(false),
    kill: () => Effect.void,
    pid: ChildProcessSpawner.ProcessId(1),
    stderr: Stream.make(encoder.encode(stderr)),
    stdin: Sink.drain,
    stdout: Stream.empty,
    unref: Effect.succeed(Effect.void),
  });
  const spawner = ChildProcessSpawner.make((command) =>
    Effect.sync(() => {
      commands.push(command);
      return handle;
    })
  );
  const userConfig = UserConfig.of({
    configPath: "/test/weave",
    init: () => Effect.void,
    lima: {
      executable: "/test/limactl",
      home: "/test/lima-home",
      runtime: "/test/lima-runtime",
    },
  });
  const terminal = Terminal.make({
    columns: Effect.succeed(80),
    display: () => Effect.void,
    readInput: Effect.die("Unexpected terminal input"),
    readLine: Effect.die("Unexpected terminal line"),
    rows: Effect.succeed(24),
  });

  return Effect.gen(function* directRunTest() {
    const lima = yield* LimaRuntime;
    const exit = yield* Effect.exit(lima.run(["copy", "source", "dev:/tmp"]));

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.pretty(exit.cause)).toContain("Failed to open VM disk");
    }
    expect(yield* TestConsole.errorLines).toEqual(["guest process failed"]);
    expect(commands[0]).toMatchObject({
      args: ["--log-format=json", "copy", "source", "dev:/tmp"],
      options: {
        stderr: "pipe",
        stdin: "inherit",
        stdout: "inherit",
      },
    });
  }).pipe(
    Effect.provide(LimaRuntimeLive),
    Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
    Effect.provideService(CliLogger, makeCliLogger(false)),
    Effect.provideService(Terminal.Terminal, terminal),
    Effect.provideService(UserConfig, userConfig)
  );
});
