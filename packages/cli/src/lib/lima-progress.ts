import { Option, Schema } from "effect";

const LimaLog = Schema.Struct({
  level: Schema.String,
  msg: Schema.String,
});

const LimaLogLine = Schema.fromJsonString(LimaLog);

export type LimaLog = typeof LimaLog.Type;

export const decodeLimaLogLine = Schema.decodeUnknownOption(LimaLogLine);

export const limaProgressMessage = (message: string): Option.Option<string> => {
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

export const formatLimaLog = (log: LimaLog): string =>
  `${log.level.toUpperCase()} ${log.msg}`;
