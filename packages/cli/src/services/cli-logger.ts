import { Cause, Console, Context, Effect, Layer } from "effect";

export interface CliLoggerService {
  readonly logCause: (cause: Cause.Cause<unknown>) => Effect.Effect<void>;
  readonly logDebug: (message: string) => Effect.Effect<void>;
}

export const CliLogger = Context.Service<CliLoggerService>(
  "weave/services/cliLogger"
);

export const formatCause = (
  cause: Cause.Cause<unknown>,
  debug: boolean
): string => {
  if (debug) {
    return Cause.pretty(cause);
  }

  return Cause.prettyErrors(cause)
    .map((error) => `✖ ${error.message}`)
    .join("\n");
};

export const makeCliLogger = (debug: boolean): CliLoggerService =>
  CliLogger.of({
    logCause: (cause) => Console.error(formatCause(cause, debug)),
    logDebug: (message) => (debug ? Console.error(message) : Effect.void),
  });

export const CliLoggerLive = Layer.succeed(
  CliLogger,
  makeCliLogger(Bun.env?.DEBUG === "1")
);
