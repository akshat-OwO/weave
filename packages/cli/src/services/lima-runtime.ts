import path from "node:path";

import type { PlatformError } from "effect";
import {
  Console,
  Context,
  Effect,
  Fiber,
  Layer,
  Option,
  Ref,
  Stream,
  Terminal,
} from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import {
  decodeLimaLogLine,
  formatLimaLog,
  limaProgressLine,
} from "../lib/lima-progress";
import { withProgress } from "../lib/progress";
import { CommandExecutionError } from "../schemas/errors/command-execution.schema";
import { UserConfig } from "./user-config";

export interface LimaRunOptions {
  readonly acceptableExitCodes?: readonly number[];
  readonly progress?: {
    readonly failureMessage: string;
    readonly initialMessage: string;
  };
}

export interface LimaCapturedOutput {
  readonly stderr: string;
  readonly stdout: string;
}

const maximumDiagnosticLines = 20;
const formatCommand = (args: readonly string[]): string =>
  args.map((argument) => JSON.stringify(argument)).join(" ");

export interface LimaRuntimeService {
  capture: (
    args: readonly string[]
  ) => Effect.Effect<
    LimaCapturedOutput,
    CommandExecutionError | PlatformError.PlatformError,
    never
  >;
  run: (
    args: readonly string[],
    options?: LimaRunOptions
  ) => Effect.Effect<
    void,
    CommandExecutionError | PlatformError.PlatformError,
    never
  >;
  status: (
    args: readonly string[]
  ) => Effect.Effect<number, PlatformError.PlatformError, never>;
}

export const LimaRuntime = Context.Service<LimaRuntimeService>(
  "weave/services/limaRuntime"
);

export const LimaRuntimeLive = Layer.effect(
  LimaRuntime,
  Effect.gen(function* handler() {
    const userConfig = yield* UserConfig;
    const processSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const terminal = yield* Terminal.Terminal;
    const environment = {
      ...Bun.env,
      LIMA_HOME: userConfig.lima.home,
      LIMA_TEMPLATES_PATH: path.join(
        userConfig.lima.runtime,
        "share",
        "lima",
        "templates"
      ),
    };

    return LimaRuntime.of({
      capture: (args) =>
        Effect.scoped(
          Effect.gen(function* captureHandler() {
            const command = ChildProcess.make(
              userConfig.lima.executable,
              args,
              {
                env: environment,
                extendEnv: true,
                stderr: "pipe",
                stdin: "inherit",
                stdout: "pipe",
              }
            );
            const handle = yield* processSpawner.spawn(command);
            const stdoutFiber = yield* handle.stdout.pipe(
              Stream.decodeText,
              Stream.mkString,
              Effect.forkScoped
            );
            const stderrFiber = yield* handle.stderr.pipe(
              Stream.decodeText,
              Stream.mkString,
              Effect.forkScoped
            );
            const exitCode = yield* handle.exitCode;
            const [stdout, stderr] = yield* Effect.all([
              Fiber.join(stdoutFiber),
              Fiber.join(stderrFiber),
            ]);

            if (exitCode !== 0) {
              if (stderr.length > 0) {
                yield* Console.error(stderr.trimEnd());
              }
              return yield* new CommandExecutionError({
                backend: "Lima",
                command: formatCommand(args),
                exitCode,
              });
            }

            return { stderr, stdout };
          })
        ),
      run: (args, options) =>
        Effect.gen(function* runHandler() {
          const acceptableExitCodes = options?.acceptableExitCodes ?? [0];

          if (options?.progress === undefined) {
            const command = ChildProcess.make(
              userConfig.lima.executable,
              args,
              {
                env: environment,
                extendEnv: true,
                stderr: "inherit",
                stdin: "inherit",
                stdout: "inherit",
              }
            );
            const exitCode = yield* processSpawner.exitCode(command);

            if (!acceptableExitCodes.includes(exitCode)) {
              return yield* new CommandExecutionError({
                backend: "Lima",
                command: formatCommand(args),
                exitCode,
              });
            }
            return;
          }

          const command = ChildProcess.make(
            userConfig.lima.executable,
            ["--log-format=json", ...args],
            {
              env: environment,
              extendEnv: true,
              stderr: "pipe",
              stdin: "inherit",
              stdout: "pipe",
            }
          );
          const diagnostics = yield* Ref.make<readonly string[]>([]);
          const appendDiagnostic = (line: string) =>
            Ref.update(diagnostics, (lines) => {
              const next = lines.slice(-(maximumDiagnosticLines - 1));
              next.push(line);
              return next;
            });
          const exitCode = yield* withProgress(
            terminal,
            options.progress.initialMessage,
            ({ setMessage }) => {
              const consumeLine = (line: string) => {
                const decoded = decodeLimaLogLine(line);
                const progressMessage = limaProgressLine(line);
                return Effect.all(
                  [
                    appendDiagnostic(
                      Option.isSome(decoded)
                        ? formatLimaLog(decoded.value)
                        : line
                    ),
                    Option.isSome(progressMessage)
                      ? setMessage(progressMessage.value)
                      : Effect.void,
                  ],
                  { discard: true }
                );
              };
              return Effect.scoped(
                Effect.gen(function* executeHandler() {
                  const handle = yield* processSpawner.spawn(command);
                  const outputFiber = yield* handle.all.pipe(
                    Stream.decodeText,
                    Stream.splitLines,
                    Stream.runForEach(consumeLine),
                    Effect.forkScoped
                  );
                  const commandExitCode = yield* handle.exitCode;
                  yield* Fiber.join(outputFiber);
                  return commandExitCode;
                })
              );
            }
          );

          if (!acceptableExitCodes.includes(exitCode)) {
            const output = yield* Ref.get(diagnostics);

            yield* Console.error(`✖ ${options.progress.failureMessage}`);
            if (output.length > 0) {
              yield* Console.error(output.join("\n"));
            }
            return yield* new CommandExecutionError({
              backend: "Lima",
              command: formatCommand(args),
              exitCode,
            });
          }
        }),
      status: (args) =>
        processSpawner.exitCode(
          ChildProcess.make(userConfig.lima.executable, args, {
            env: environment,
            extendEnv: true,
            stderr: "ignore",
            stdin: "ignore",
            stdout: "ignore",
          })
        ),
    });
  })
);
