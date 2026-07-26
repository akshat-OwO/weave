import * as BunPath from "@effect/platform-bun/BunPath";
import * as BunTerminal from "@effect/platform-bun/BunTerminal";
import { Effect, FileSystem, Layer, Stdio, Stream } from "effect";
import { TestConsole } from "effect/testing";
import { Command } from "effect/unstable/cli";
import { ChildProcessSpawner } from "effect/unstable/process";

import { weave } from "../../src/cmds";
import type {
  CreateVmRequest,
  VmListItem,
} from "../../src/services/vm-manager";
import { VmManager } from "../../src/services/vm-manager";

export type VmManagerCall =
  | { readonly method: "create"; readonly request: CreateVmRequest }
  | { readonly method: "kill"; readonly name: string }
  | { readonly method: "list" }
  | {
      readonly command: string;
      readonly method: "shell";
      readonly name: string;
    }
  | { readonly method: "ssh"; readonly name: string }
  | { readonly method: "stop"; readonly name: string };

export interface CliHarness {
  readonly calls: VmManagerCall[];
  readonly stderr: string[];
  readonly stdout: string[];
  readonly run: (
    args: readonly string[]
  ) => Effect.Effect<void, unknown, never>;
}

interface CliHarnessOptions {
  readonly createAction?: "Created" | "Started";
  readonly vms?: readonly VmListItem[];
}

export const makeCliHarness = (options: CliHarnessOptions = {}): CliHarness => {
  const calls: VmManagerCall[] = [];
  const stderr: string[] = [];
  const stdout: string[] = [];
  const manager = VmManager.of({
    create: (request) =>
      Effect.sync(() => {
        calls.push({ method: "create", request });
        return options.createAction ?? "Created";
      }),
    kill: (name) =>
      Effect.sync(() => {
        calls.push({ method: "kill", name });
      }),
    list: () =>
      Effect.sync(() => {
        calls.push({ method: "list" });
        return options.vms ?? [];
      }),
    shell: (name, command) =>
      Effect.sync(() => {
        calls.push({ command, method: "shell", name });
      }),
    ssh: (name) =>
      Effect.sync(() => {
        calls.push({ method: "ssh", name });
      }),
    stop: (name) =>
      Effect.sync(() => {
        calls.push({ method: "stop", name });
      }),
  });
  const fileSystem = FileSystem.makeNoop({});
  const processSpawner = ChildProcessSpawner.ChildProcessSpawner.of({
    exitCode: () => Effect.die("Unexpected process exitCode call"),
    lines: () => Effect.die("Unexpected process lines call"),
    spawn: () => Effect.die("Unexpected process spawn call"),
    streamLines: () => Stream.die("Unexpected process streamLines call"),
    streamString: () => Stream.die("Unexpected process streamString call"),
    string: () => Effect.die("Unexpected process string call"),
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
        Effect.provideService(VmManager, manager),
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

  return { calls, run, stderr, stdout };
};
