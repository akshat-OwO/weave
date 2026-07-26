import { Clock, Console, Effect, Option } from "effect";
import { Command } from "effect/unstable/cli";

import { formatRemainingTtl, readVmTtl } from "../lib/vm-ttl";
import { LimaRuntime } from "../services/lima-runtime";
import { UserConfig } from "../services/user-config";

const emptyVmTable = "NAME\tSTATUS\tSSH\tVMTYPE\tARCH\tCPUS\tMEMORY\tDISK\tDIR";
const noInstancesWarning =
  "No instance found. Run `limactl create` to create an instance.";
const ttlColumnWidth = 8;

const parseVmRow = (
  row: string
): { readonly name: string; readonly status: string } | undefined => {
  const [name, status] = row.trimStart().split(/\s+/u);

  return name === undefined || status === undefined
    ? undefined
    : { name, status };
};

export const vmNamesFromList = (stdout: string): readonly string[] =>
  stdout
    .trim()
    .split(/\r?\n/u)
    .slice(1)
    .map(parseVmRow)
    .filter((row) => row !== undefined)
    .map(({ name }) => name);

export const formatVmList = (
  stdout: string,
  expiresAtByVm: ReadonlyMap<string, number> = new Map(),
  currentTimeMillis = 0
): string => {
  const table = stdout.trimEnd() || emptyVmTable;
  const rows = table.split(/\r?\n/u);
  const [header] = rows;
  const dirColumnIndex = header?.lastIndexOf("DIR") ?? -1;
  const insertTtl = (row: string, ttl: string): string => {
    if (dirColumnIndex < 0) {
      return `${row}  ${ttl}`;
    }

    return `${row.slice(0, dirColumnIndex)}${ttl.padEnd(ttlColumnWidth)}${row.slice(dirColumnIndex)}`;
  };

  return rows
    .map((row, index) => {
      if (index === 0) {
        return insertTtl(row, "TTL");
      }

      const vm = parseVmRow(row);
      const expiresAt =
        vm === undefined ? undefined : expiresAtByVm.get(vm.name);
      const ttl =
        vm?.status === "Running" && expiresAt !== undefined
          ? formatRemainingTtl(expiresAt, currentTimeMillis)
          : "-";

      return insertTtl(row, ttl);
    })
    .join("\n");
};

export const formatVmListWarnings = (stderr: string): string =>
  stderr
    .split(/\r?\n/u)
    .filter((line) => !line.includes(noInstancesWarning))
    .join("\n")
    .trim();

export const list = Command.make("ls", {}, () =>
  Effect.gen(function* listHandler() {
    const lima = yield* LimaRuntime;
    const userConfig = yield* UserConfig;
    const output = yield* lima.capture(["list"]);
    const warnings = formatVmListWarnings(output.stderr);
    const expiresAtByVm = new Map<string, number>();

    for (const name of vmNamesFromList(output.stdout)) {
      const expiresAt = yield* readVmTtl(userConfig.lima.home, name);
      if (Option.isSome(expiresAt)) {
        expiresAtByVm.set(name, expiresAt.value);
      }
    }

    if (warnings.length > 0) {
      yield* Console.error(warnings);
    }
    yield* Console.log(
      formatVmList(output.stdout, expiresAtByVm, yield* Clock.currentTimeMillis)
    );
  })
).pipe(
  Command.withAlias("list"),
  Command.withDescription("List Lima VMs with their status and remaining TTL"),
  Command.withExamples([{ command: "weave ls" }])
);
