import { Option, Schema } from "effect";

const LimaLog = Schema.Struct({
  level: Schema.String,
  msg: Schema.String,
});

const LimaLogLine = Schema.fromJsonString(LimaLog);
const LogfmtQuotedValue = Schema.fromJsonString(Schema.String);

export type LimaLog = typeof LimaLog.Type;

export const decodeLimaLogLine = Schema.decodeUnknownOption(LimaLogLine);
const decodeLogfmtQuotedValue = Schema.decodeUnknownOption(LogfmtQuotedValue);

const actionableLogLevels = new Set([
  "error",
  "fatal",
  "panic",
  "warn",
  "warning",
]);
const plainDiagnosticPattern =
  /^(?<level>WARN(?:ING)?|ERRO(?:R)?|FATAL|PANIC)\[\d+\]\s*(?<message>.*)$/iu;
const logfmtLevelPattern = /\blevel=(?<level>"(?:\\.|[^"\\])*"|[^\s]+)/u;
const logfmtMessagePattern = /\bmsg=(?<message>"(?:\\.|[^"\\])*"|[^\s]+)/u;
const preferredFailureMessagePatterns = [/^No instance matching\b/iu] as const;
const ignoredFailureMessagePatterns = [
  /^failed to detect whether running under rosetta\b/iu,
] as const;
const aptDownloadPattern =
  /^\[cloud-init\]\s+Get:\d+\s+.+\[(?<amount>\d+(?:\.\d+)?)\s*(?<unit>B|kB|MB|GB)\]\s*$/u;
const completedPackageDownloadPattern =
  /^\[cloud-init\]\s+(?!Total(?:\s|$)).+\|\s*(?<amount>\d+(?:\.\d+)?)\s*(?<unit>B|kB|KB|MB|GB|KiB|MiB|GiB)\s+\d{2}:\d{2}\s*$/u;
const aptFetchedPattern =
  /^\[cloud-init\]\s+Fetched\s+(?<amount>\d+(?:\.\d+)?\s*(?:B|kB|MB|GB))\s+in\s+(?<duration>.+?)\s+\(/u;
const aptRequiredDownloadPattern =
  /^\[cloud-init\]\s+Need to get\s+(?<amount>\d+(?:\.\d+)?\s*(?:B|kB|MB|GB))\s+of archives/u;
const packageIndexCommandPatterns = [
  /\bapt(?:-get)?(?:\s+-\S+)*\s+update\b/u,
  /\b(?:dnf|yum)(?:\s+-\S+)*\s+makecache\b/u,
  /\bapk(?:\s+-\S+)*\s+update\b/u,
  /\bpacman\b.*\s-\S*Sy\S*\b/u,
] as const;
const packageInstallCommandPatterns = [
  /\bapt(?:-get)?(?:\s+-\S+)*\s+install\b/u,
  /\b(?:dnf|yum)(?:\s+-\S+)*\s+(?:install|update|upgrade)\b/u,
  /\bapk(?:\s+-\S+)*\s+add\b/u,
  /\bpacman\b.*\s-\S*S\S*\b/u,
] as const;
const plainLevelAliases: Readonly<Record<string, string>> = {
  ERRO: "ERROR",
  WARN: "WARNING",
};
const KILOBYTE = 1000;
const MEGABYTE = 1_000_000;
const GIGABYTE = 1_000_000_000;
const KIBIBYTE = 1024;
const MEBIBYTE = 1024 * KIBIBYTE;
const GIBIBYTE = 1024 * MEBIBYTE;
const byteMultipliers: Readonly<Record<string, number>> = {
  B: 1,
  GB: GIGABYTE,
  GiB: GIBIBYTE,
  KB: KILOBYTE,
  KiB: KIBIBYTE,
  MB: MEGABYTE,
  MiB: MEBIBYTE,
  kB: KILOBYTE,
};

const messageFromLine = (line: string): string => {
  const decoded = decodeLimaLogLine(line);
  return Option.isSome(decoded) ? decoded.value.msg : line;
};

const decodeLogfmtValue = (value: string): Option.Option<string> =>
  value.startsWith('"') ? decodeLogfmtQuotedValue(value) : Option.some(value);

const logfmtDiagnosticMessage = (line: string): Option.Option<string> => {
  const levelValue = logfmtLevelPattern.exec(line)?.groups?.level;
  const messageValue = logfmtMessagePattern.exec(line)?.groups?.message;

  if (levelValue === undefined || messageValue === undefined) {
    return Option.none();
  }

  const level = decodeLogfmtValue(levelValue);
  const message = decodeLogfmtValue(messageValue);

  if (
    Option.isNone(level) ||
    Option.isNone(message) ||
    !actionableLogLevels.has(level.value.toLowerCase())
  ) {
    return Option.none();
  }

  return message;
};

export const limaFailureMessage = (stderr: string): Option.Option<string> => {
  const messages: string[] = [];

  for (const line of stderr.split(/\r?\n/u)) {
    const decoded = decodeLimaLogLine(line);
    if (
      Option.isSome(decoded) &&
      actionableLogLevels.has(decoded.value.level.toLowerCase())
    ) {
      messages.push(decoded.value.msg);
      continue;
    }

    const logfmtMessage = logfmtDiagnosticMessage(line);
    if (Option.isSome(logfmtMessage)) {
      messages.push(logfmtMessage.value);
      continue;
    }

    const plain = plainDiagnosticPattern.exec(line);
    if (plain?.groups?.message !== undefined) {
      messages.push(plain.groups.message);
    }
  }

  const message =
    messages.find((candidate) =>
      preferredFailureMessagePatterns.some((pattern) => pattern.test(candidate))
    ) ??
    messages.find(
      (candidate) =>
        !ignoredFailureMessagePatterns.some((pattern) =>
          pattern.test(candidate)
        )
    ) ??
    messages[0];

  return message === undefined ? Option.none() : Option.some(message);
};

export type PackageDownloadPhase = "indexes" | "packages";

export const limaPackageDownloadPhase = (
  line: string
): Option.Option<PackageDownloadPhase> => {
  const message = messageFromLine(line);

  if (!message.includes("[cloud-init]")) {
    return Option.none();
  }
  if (packageIndexCommandPatterns.some((pattern) => pattern.test(message))) {
    return Option.some("indexes");
  }
  if (packageInstallCommandPatterns.some((pattern) => pattern.test(message))) {
    return Option.some("packages");
  }
  return Option.none();
};

export const limaPackageDownloadBytes = (
  line: string
): Option.Option<number> => {
  const message = messageFromLine(line);
  const match =
    aptDownloadPattern.exec(message) ??
    completedPackageDownloadPattern.exec(message);
  const amount = match?.groups?.amount;
  const unit = match?.groups?.unit;

  if (amount === undefined || unit === undefined) {
    return Option.none();
  }

  const multiplier = byteMultipliers[unit];
  return multiplier === undefined
    ? Option.none()
    : Option.some(Number(amount) * multiplier);
};

export const formatDownloadBytes = (bytes: number): string => {
  if (bytes >= GIGABYTE) {
    return `${(bytes / GIGABYTE).toFixed(1)} GB`;
  }
  if (bytes >= MEGABYTE) {
    return `${(bytes / MEGABYTE).toFixed(1)} MB`;
  }
  if (bytes >= KILOBYTE) {
    return `${(bytes / KILOBYTE).toFixed(1)} kB`;
  }
  return `${bytes} B`;
};

export const formatProgressElapsed = (elapsedMillis: number): string => {
  const elapsedSeconds = Math.max(0, Math.floor(elapsedMillis / 1000));
  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
};

const packageManagerProgressMessage = (
  message: string
): Option.Option<string> => {
  const fetched = aptFetchedPattern.exec(message);
  if (fetched?.groups?.amount !== undefined) {
    const { duration } = fetched.groups;
    return Option.some(
      duration === undefined
        ? `Downloaded VM dependencies (${fetched.groups.amount})`
        : `Downloaded VM dependencies (${fetched.groups.amount} in ${duration})`
    );
  }

  const requiredDownload = aptRequiredDownloadPattern.exec(message);
  if (requiredDownload?.groups?.amount !== undefined) {
    return Option.some(
      `Downloading VM packages… ${requiredDownload.groups.amount} total`
    );
  }

  if (/^\[cloud-init\]\s+Ign:\d+\s+/u.test(message)) {
    return Option.some("Package mirror is slow; retrying…");
  }

  if (/^\[cloud-init\]\s+Err:\d+\s+/u.test(message)) {
    return Option.some("Package mirror request failed; retrying…");
  }

  if (/^\[cloud-init\]\s+fetch\s+\S*APKINDEX\S*/u.test(message)) {
    return Option.some("Downloading package indexes…");
  }

  if (/^\[cloud-init\]\s+fetch\s+\S+/u.test(message)) {
    return Option.some("Downloading VM packages…");
  }

  if (/^\[cloud-init\]\s+.+(?:\.rpm\b|\.pkg\.tar\.\S+\b)/u.test(message)) {
    return Option.some("Downloading VM packages…");
  }

  if (
    /^\[cloud-init\]\s+.+(?:downloading|\.db\b)/iu.test(message) &&
    /\.db\b/u.test(message)
  ) {
    return Option.some("Downloading package indexes…");
  }

  if (/^\[cloud-init\]\s+\S+\s+downloading\.\.\.\s*$/iu.test(message)) {
    return Option.some("Downloading VM packages…");
  }

  if (packageIndexCommandPatterns.some((pattern) => pattern.test(message))) {
    return Option.some("Updating package indexes…");
  }

  if (packageInstallCommandPatterns.some((pattern) => pattern.test(message))) {
    return Option.some("Installing VM dependencies…");
  }

  return Option.none();
};

const cloudInitProgressMessage = (message: string): Option.Option<string> => {
  if (!message.includes("[cloud-init]")) {
    return Option.none();
  }

  const packageManagerProgress = packageManagerProgressMessage(message);
  if (Option.isSome(packageManagerProgress)) {
    return packageManagerProgress;
  }

  if (message.includes("nerdctl-full.tgz") && message.includes("tar Cxaf")) {
    return Option.some(
      message.includes(" bin/nerdctl")
        ? "Checking container tooling…"
        : "Extracting container tooling…"
    );
  }

  if (
    message.includes("containerd-rootless-setuptool.sh") ||
    message.includes("systemctl enable --now containerd")
  ) {
    return Option.some("Starting container services…");
  }

  return Option.none();
};

export const limaProgressMessage = (message: string): Option.Option<string> => {
  if (message.includes("Downloading the nerdctl archive")) {
    return Option.some("Downloading container tooling…");
  }

  const cloudInitProgress = cloudInitProgressMessage(message);

  if (Option.isSome(cloudInitProgress)) {
    return cloudInitProgress;
  }

  if (!message.includes("[cloud-init]") && message.includes("Downloading ")) {
    return Option.some("Downloading VM image…");
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

  if (message.includes("Cloud-init provisioning started")) {
    return Option.some("Provisioning virtual machine…");
  }

  if (message.includes("Cloud-init progress monitoring done")) {
    return Option.some("Finishing virtual machine setup…");
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

export const limaProgressLine = (line: string): Option.Option<string> =>
  limaProgressMessage(messageFromLine(line));

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
