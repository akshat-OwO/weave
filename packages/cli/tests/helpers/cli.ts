import * as BunPath from "@effect/platform-bun/BunPath";
import * as BunTerminal from "@effect/platform-bun/BunTerminal";
import { Effect, FileSystem, Layer, Stdio, Stream } from "effect";
import { Command } from "effect/unstable/cli";
import { ChildProcessSpawner } from "effect/unstable/process";
import type { ChildProcess } from "effect/unstable/process";

import { weave } from "../../src/cmds";
import { LimaRuntime } from "../../src/services/lima-runtime";
import { UserConfig } from "../../src/services/user-config";

export interface LimaCall {
  readonly args: readonly string[];
  readonly acceptableExitCodes?: readonly number[];
}

export interface CliHarness {
  readonly calls: LimaCall[];
  readonly processCalls: ChildProcess.Command[];
  readonly run: (
    args: readonly string[]
  ) => Effect.Effect<void, unknown, never>;
}

interface CliHarnessOptions {
  readonly existingVm?: boolean;
  readonly processOutputs?: readonly string[];
}

const configPath = "/test/weave";
const limaHome = `${configPath}/lima-home`;

export const makeCliHarness = (options: CliHarnessOptions = {}): CliHarness => {
  const calls: LimaCall[] = [];
  const processCalls: ChildProcess.Command[] = [];
  const processOutputs = [...(options.processOutputs ?? [])];

  const lima = LimaRuntime.of({
    assertIsolated: () => Effect.void,
    run: (args, runOptions) =>
      Effect.sync(() => {
        calls.push({
          acceptableExitCodes: runOptions?.acceptableExitCodes,
          args,
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
    Command.runWith(weave, { version: "0.0.0" })(args).pipe(
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
      Effect.mapError((error) => error as unknown)
    );

  return { calls, processCalls, run };
};
