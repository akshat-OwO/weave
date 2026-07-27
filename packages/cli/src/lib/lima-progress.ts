import { Option, Schema } from "effect";

const LimaLog = Schema.Struct({
  level: Schema.String,
  msg: Schema.String,
});

const LimaLogLine = Schema.fromJsonString(LimaLog);

export type LimaLog = typeof LimaLog.Type;

export const decodeLimaLogLine = Schema.decodeUnknownOption(LimaLogLine);

const actionableLogLevels = new Set([
  "error",
  "fatal",
  "panic",
  "warn",
  "warning",
]);
const plainDiagnosticPattern =
  /^(?<level>WARN(?:ING)?|ERRO(?:R)?|FATAL|PANIC)\[\d+\]\s*(?<message>.*)$/iu;
const plainLevelAliases: Readonly<Record<string, string>> = {
  ERRO: "ERROR",
  WARN: "WARNING",
};

export const limaProgressMessage = (message: string): Option.Option<string> => {
  if (message.includes("Downloading ")) {
    return Option.some("Downloading Ubuntu image…");
  }

  if (
    message.includes("Decompressing ") ||
    (message.includes("Converting ") &&
      message.includes(" image to raw sparse format"))
  ) {
    return Option.some("Preparing VM image…");
  }

  if (message.includes("user session is ready for ssh")) {
    return Option.some("Waiting for SSH…");
  }

  if (message.includes("Guest agent is running")) {
    return Option.some("Starting guest services…");
  }

  if (message.includes("containerd binaries to be installed")) {
    return Option.some("Installing container tooling…");
  }

  if (message.includes("boot scripts must have finished")) {
    return Option.some("Running boot scripts…");
  }

  if (message.includes("Shutting down the SSH master")) {
    return Option.some("Closing SSH connections…");
  }

  if (message.includes("Shutting down the host agent")) {
    return Option.some("Stopping guest services…");
  }

  return Option.none();
};

export const limaProgressLine = (line: string): Option.Option<string> => {
  const decoded = decodeLimaLogLine(line);

  return limaProgressMessage(
    Option.match(decoded, {
      onNone: () => line,
      onSome: (log) => log.msg,
    })
  );
};

export const formatLimaLog = (log: LimaLog): string =>
  `${log.level.toUpperCase()} ${log.msg}`;

export const limaActionableDiagnosticLine = (
  line: string
): Option.Option<string> => {
  const decoded = decodeLimaLogLine(line);

  if (Option.isSome(decoded)) {
    return actionableLogLevels.has(decoded.value.level.toLowerCase())
      ? Option.some(formatLimaLog(decoded.value))
      : Option.none();
  }

  const match = plainDiagnosticPattern.exec(line);

  if (match === null) {
    return Option.none();
  }

  const level = match.groups?.level?.toUpperCase();
  const message = match.groups?.message;

  if (level === undefined || message === undefined) {
    return Option.none();
  }

  return Option.some(`${plainLevelAliases[level] ?? level} ${message}`);
};
