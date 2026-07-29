import path from "node:path";

import type { PlatformError } from "effect";
import {
  Clock,
  Console,
  Context,
  Effect,
  Fiber,
  Layer,
  Option,
  Ref,
  Schedule,
  Stream,
  Terminal,
} from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import {
  decodeLimaLogLine,
  formatDownloadBytes,
  formatLimaLog,
  formatProgressElapsed,
  limaActionableDiagnosticLine,
  limaFailureMessage,
  limaPackageDownloadBytes,
  limaPackageDownloadPhase,
  limaProgressLine,
} from "../lib/lima-progress";
import { UnsafeVmBackendError } from "../schemas/errors/unsafe-vm-backend.schema";
import { CliLogger } from "./cli-logger";
import { UserConfig } from "./user-config";

interface RunOptions {
  readonly acceptableExitCodes?: readonly number[];
  readonly progress?: {
    readonly failureMessage: string;
    readonly initialMessage: string;
    readonly startedAt?: number;
  };
}

interface CapturedOutput {
  readonly stderr: string;
  readonly stdout: string;
}

const spinnerFrames = [
  "⠋",
  "⠙",
  "⠹",
  "⠸",
  "⠼",
  "⠴",
  "⠦",
  "⠧",
  "⠇",
  "⠏",
] as const;
const clearLine = "\r\u001B[2K";
const hideCursor = "\u001B[?25l";
const showCursor = "\u001B[?25h";
const maximumDiagnosticLines = 20;

export const LimaRuntime = Context.Service<{
  assertIsolated: (
    instance: string
  ) => Effect.Effect<
    void,
    PlatformError.PlatformError | UnsafeVmBackendError,
    never
  >;
  capture: (
    args: readonly string[]
  ) => Effect.Effect<CapturedOutput, PlatformError.PlatformError, never>;
  run: (
    args: readonly string[],
    options?: RunOptions
  ) => Effect.Effect<void, PlatformError.PlatformError, never>;
}>("weave/services/limaRuntime");

export const LimaRuntimeLive = Layer.effect(
  LimaRuntime,
  Effect.gen(function* handler() {
    const logger = yield* CliLogger;
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
      assertIsolated: (instance) =>
        Effect.gen(function* assertIsolatedHandler() {
          yield* userConfig.init();
          if (process.platform === "win32") {
            const command = ChildProcess.make(
              userConfig.lima.executable,
              ["list", instance, "--format={{.VMType}}"],
              {
                env: environment,
                extendEnv: true,
              }
            );
            const backend = (yield* processSpawner.string(command)).trim();

            if (backend !== "qemu") {
              return yield* new UnsafeVmBackendError({
                backend,
                name: instance,
              });
            }
          }
        }),
      capture: (args) =>
        Effect.scoped(
          Effect.gen(function* captureHandler() {
            yield* userConfig.init();
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
                yield* logger.logDebug(stderr.trimEnd());
              }
              const message = Option.getOrElse(
                limaFailureMessage(stderr),
                () => `Command exited with code ${exitCode}`
              );
              return yield* Effect.die(message);
            }

            return { stderr, stdout };
          })
        ),
      run: (args, options) =>
        Effect.gen(function* runHandler() {
          yield* userConfig.init();
          const acceptableExitCodes = options?.acceptableExitCodes ?? [0];

          if (options?.progress === undefined) {
            const command = ChildProcess.make(
              userConfig.lima.executable,
              ["--log-format=json", ...args],
              {
                env: environment,
                extendEnv: true,
                stderr: "pipe",
                stdin: "inherit",
                stdout: "inherit",
              }
            );
            return yield* Effect.scoped(
              Effect.gen(function* directRunHandler() {
                const diagnostics = yield* Ref.make<readonly string[]>([]);
                const handle = yield* processSpawner.spawn(command);
                const stderrFiber = yield* handle.stderr.pipe(
                  Stream.decodeText,
                  Stream.splitLines,
                  Stream.runForEach((line) => {
                    if (Option.isNone(decodeLimaLogLine(line))) {
                      return Console.error(line);
                    }

                    return Effect.all(
                      [
                        Ref.update(diagnostics, (lines) => [
                          ...lines.slice(-(maximumDiagnosticLines - 1)),
                          line,
                        ]),
                        logger.logDebug(line),
                      ],
                      { discard: true }
                    );
                  }),
                  Effect.forkScoped
                );
                const exitCode = yield* handle.exitCode;
                yield* Fiber.join(stderrFiber);

                if (!acceptableExitCodes.includes(exitCode)) {
                  const output = yield* Ref.get(diagnostics);
                  const message = Option.getOrElse(
                    limaFailureMessage(output.join("\n")),
                    () => `Command exited with code ${exitCode}`
                  );
                  return yield* Effect.die(message);
                }
              })
            );
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
          const isInteractive =
            process.stdout.isTTY === true &&
            Bun.env.CI !== "true" &&
            Bun.env.TERM !== "dumb";
          const startedAt =
            options.progress.startedAt ?? (yield* Clock.currentTimeMillis);
          const message = yield* Ref.make(options.progress.initialMessage);
          const packageDownloadBytes = yield* Ref.make(0);
          const packageDownloadPhase = yield* Ref.make<"indexes" | "packages">(
            "indexes"
          );
          const diagnostics = yield* Ref.make<readonly string[]>([]);
          const actionableDiagnostics = yield* Ref.make<readonly string[]>([]);
          const publishMessage = (nextMessage: string) =>
            Effect.gen(function* publishMessageHandler() {
              const previousMessage = yield* Ref.getAndSet(
                message,
                nextMessage
              );
              if (!isInteractive && previousMessage !== nextMessage) {
                yield* Console.log(nextMessage);
              }
            });
          const appendDiagnostic = (line: string) =>
            Ref.update(diagnostics, (lines) => {
              const next = lines.slice(-(maximumDiagnosticLines - 1));
              next.push(line);
              return next;
            });
          const appendActionableDiagnostic = (line: string) =>
            Ref.update(actionableDiagnostics, (lines) => {
              const next = lines.slice(-(maximumDiagnosticLines - 1));
              next.push(line);
              return next;
            });
          const updateProgress = (line: string) =>
            Effect.gen(function* updateProgressHandler() {
              const phase = limaPackageDownloadPhase(line);
              if (Option.isSome(phase)) {
                yield* Ref.set(packageDownloadPhase, phase.value);
                yield* Ref.set(packageDownloadBytes, 0);
              }

              const downloadedBytes = limaPackageDownloadBytes(line);
              if (Option.isSome(downloadedBytes)) {
                const totalBytes = yield* Ref.updateAndGet(
                  packageDownloadBytes,
                  (total) => total + downloadedBytes.value
                );
                const currentPhase = yield* Ref.get(packageDownloadPhase);
                const label =
                  currentPhase === "indexes"
                    ? "Downloading package indexes"
                    : "Downloading VM packages";
                yield* publishMessage(
                  `${label}… ${formatDownloadBytes(totalBytes)} received`
                );
                return;
              }

              const progressMessage = limaProgressLine(line);
              if (Option.isSome(progressMessage)) {
                yield* publishMessage(progressMessage.value);
              }
            });
          const consumeLine = (line: string) => {
            const decoded = decodeLimaLogLine(line);
            const actionableDiagnostic = limaActionableDiagnosticLine(line);

            if (Option.isNone(decoded)) {
              return Effect.all(
                [
                  appendDiagnostic(line),
                  Option.isSome(actionableDiagnostic)
                    ? appendActionableDiagnostic(actionableDiagnostic.value)
                    : Effect.void,
                  updateProgress(line),
                ],
                { discard: true }
              );
            }

            return Effect.all(
              [
                appendDiagnostic(formatLimaLog(decoded.value)),
                Option.isSome(actionableDiagnostic)
                  ? appendActionableDiagnostic(actionableDiagnostic.value)
                  : Effect.void,
                updateProgress(line),
              ],
              { discard: true }
            );
          };
          const execute = Effect.gen(function* executeHandler() {
            const handle = yield* processSpawner.spawn(command);
            const outputFiber = yield* handle.all.pipe(
              Stream.decodeText,
              Stream.splitLines,
              Stream.runForEach(consumeLine),
              Effect.forkScoped
            );
            const exitCode = yield* handle.exitCode;
            yield* Fiber.join(outputFiber);
            return exitCode;
          });
          let exitCode: number;

          if (isInteractive) {
            exitCode = yield* Effect.scoped(
              Effect.gen(function* interactiveProgressHandler() {
                const frame = yield* Ref.make(0);
                const display = (text: string) =>
                  terminal.display(text).pipe(Effect.ignore);
                const render = Effect.gen(function* renderHandler() {
                  const frameIndex = yield* Ref.getAndUpdate(
                    frame,
                    (index) => (index + 1) % spinnerFrames.length
                  );
                  const currentMessage = yield* Ref.get(message);
                  const currentTime = yield* Clock.currentTimeMillis;
                  const elapsedMillis = currentTime - startedAt;
                  const elapsed =
                    elapsedMillis >= 1000
                      ? ` · ${formatProgressElapsed(elapsedMillis)} elapsed`
                      : "";
                  yield* display(
                    `${clearLine}${spinnerFrames[frameIndex]} ${currentMessage}${elapsed}`
                  );
                });

                yield* display(hideCursor);
                yield* Effect.addFinalizer(() =>
                  display(`${clearLine}${showCursor}`)
                );
                yield* render.pipe(
                  Effect.repeat(Schedule.spaced("80 millis")),
                  Effect.forkScoped
                );
                return yield* execute;
              })
            );
          } else {
            yield* Console.log(options.progress.initialMessage);
            exitCode = yield* Effect.scoped(execute);
          }

          if (!acceptableExitCodes.includes(exitCode)) {
            const output = yield* Ref.get(diagnostics);

            yield* Console.error(`✖ ${options.progress.failureMessage}`);
            if (output.length > 0) {
              yield* Console.error(output.join("\n"));
            }
            return yield* Effect.die(`Command exited with code ${exitCode}`);
          }

          const output = yield* Ref.get(actionableDiagnostics);
          if (output.length > 0) {
            yield* Console.error(output.join("\n"));
          }
        }),
    });
  })
);
