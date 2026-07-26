import type { Terminal } from "effect";
import { Console, Effect, Ref, Schedule } from "effect";

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

export interface ProgressReporter {
  readonly setMessage: (message: string) => Effect.Effect<void>;
}

export const withProgress = <A, E, R>(
  terminal: Terminal.Terminal,
  initialMessage: string,
  use: (reporter: ProgressReporter) => Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> =>
  Effect.gen(function* withProgressHandler() {
    const message = yield* Ref.make(initialMessage);
    const task = use({
      setMessage: (nextMessage) => Ref.set(message, nextMessage),
    });
    const isInteractive =
      process.stdout.isTTY === true &&
      Bun.env.CI !== "true" &&
      Bun.env.TERM !== "dumb";

    if (!isInteractive) {
      yield* Console.log(initialMessage);
      return yield* task;
    }

    return yield* Effect.scoped(
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
          yield* display(
            `${clearLine}${spinnerFrames[frameIndex]} ${currentMessage}`
          );
        });

        yield* display(hideCursor);
        yield* Effect.addFinalizer(() => display(`${clearLine}${showCursor}`));
        yield* render.pipe(
          Effect.repeat(Schedule.spaced("80 millis")),
          Effect.forkScoped
        );
        return yield* task;
      })
    );
  });
