import * as BunPath from "@effect/platform-bun/BunPath";
import * as BunTerminal from "@effect/platform-bun/BunTerminal";
import { Effect, FileSystem, Layer, Stdio, Stream } from "effect";
import { TestConsole } from "effect/testing";
import { Command } from "effect/unstable/cli";
import { ChildProcessSpawner } from "effect/unstable/process";
import type { ChildProcess } from "effect/unstable/process";

import { weave } from "../../src/cmds";
import { LimaRuntime } from "../../src/services/lima-runtime";
import { UserConfig } from "../../src/services/user-config";

export interface LimaCall {
  readonly args: readonly string[];
  readonly acceptableExitCodes?: readonly number[];
  readonly captured?: boolean;
  readonly progress?: {
    readonly failureMessage: string;
    readonly initialMessage: string;
  };
}

export interface CliHarness {
  readonly calls: LimaCall[];
  readonly processCalls: ChildProcess.Command[];
  readonly stderr: string[];
  readonly stdout: string[];
  readonly run: (
    args: readonly string[]
  ) => Effect.Effect<void, unknown, never>;
}

interface CliHarnessOptions {
  readonly existingVm?: boolean;
  readonly limaOutputs?: readonly {
    readonly stderr: string;
    readonly stdout: string;
  }[];
  readonly processOutputs?: readonly string[];
}

const configPath = "/test/weave";
const limaHome = `${configPath}/lima-home`;

export const makeCliHarness = (options: CliHarnessOptions = {}): CliHarness => {
  const calls: LimaCall[] = [];
  const limaOutputs = [...(options.limaOutputs ?? [])];
  const processCalls: ChildProcess.Command[] = [];
  const processOutputs = [...(options.processOutputs ?? [])];
  const stderr: string[] = [];
  const stdout: string[] = [];

  const lima = LimaRuntime.of({
    assertIsolated: () => Effect.void,
    capture: (args) =>
      Effect.sync(() => {
        calls.push({ args, captured: true });
        return limaOutputs.shift() ?? { stderr: "", stdout: "" };
      }),
    run: (args, runOptions) =>
      Effect.sync(() => {
        calls.push({
          acceptableExitCodes: runOptions?.acceptableExitCodes,
          args,
          progress: runOptions?.progress,
        });
      }),
  });
  const userConfig = UserConfig.of({
    configPath,
    init: () => Effect.void,
    lima: {
      executable: "/test/bin/limactl",
      home: limaHome,
      runtime: "/test/runtime/lima",
    },
  });
  const fileSystem = FileSystem.makeNoop({
    exists: (path) =>
      Effect.succeed(options.existingVm === true && path === `${limaHome}/dev`),
    makeDirectory: () => Effect.void,
    writeFileString: () => Effect.void,
  });
  const processSpawner = ChildProcessSpawner.ChildProcessSpawner.of({
    exitCode: () => Effect.die("Unexpected process exitCode call"),
    lines: () => Effect.die("Unexpected process lines call"),
    spawn: () => Effect.die("Unexpected process spawn call"),
    streamLines: () => Stream.die("Unexpected process streamLines call"),
    streamString: () => Stream.die("Unexpected process streamString call"),
    string: (command) =>
      Effect.sync(() => {
        processCalls.push(command);
        return processOutputs.shift() ?? "";
      }),
  });

  const run = (args: readonly string[]) =>
    Effect.gen(function* runHandler() {
      const initialLogCount = (yield* TestConsole.logLines).length;
      const initialErrorCount = (yield* TestConsole.errorLines).length;
      const captureOutput = Effect.gen(function* captureOutputHandler() {
        const logs = yield* TestConsole.logLines;
        const errors = yield* TestConsole.errorLines;

        stdout.push(...logs.slice(initialLogCount).map(String));
        stderr.push(...errors.slice(initialErrorCount).map(String));
      });

      return yield* Command.runWith(weave, { version: "0.0.0" })(args).pipe(
        Effect.provideService(LimaRuntime, lima),
        Effect.provideService(UserConfig, userConfig),
        Effect.provideService(FileSystem.FileSystem, fileSystem),
        Effect.provideService(
          ChildProcessSpawner.ChildProcessSpawner,
          processSpawner
        ),
        Effect.provide(
          Layer.mergeAll(BunPath.layer, BunTerminal.layer, Stdio.layerTest({}))
        ),
        Effect.mapError((error) => error as unknown),
        Effect.ensuring(captureOutput)
      );
    });

  return { calls, processCalls, run, stderr, stdout };
};
