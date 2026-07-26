import { Clock, Console, Effect } from "effect";
import { Command } from "effect/unstable/cli";

import { formatRemainingTtl } from "../lib/vm-ttl";
import { VmManager } from "../services/vm-manager";
import type { VmListItem } from "../services/vm-manager";

const headers = ["NAME", "STATUS", "BACKEND", "CPUS", "MEMORY", "TTL"] as const;

const padColumns = (rows: readonly (readonly string[])[]): string => {
  const widths = headers.map((_, column) =>
    Math.max(...rows.map((row) => row[column]?.length ?? 0))
  );
  return rows
    .map((row) =>
      row
        .map((value, column) =>
          column === row.length - 1
            ? value
            : value.padEnd(widths[column] ?? value.length)
        )
        .join("  ")
    )
    .join("\n");
};

export const formatVmList = (
  vms: readonly VmListItem[],
  currentTimeMillis = 0
): string => {
  const rows: readonly (readonly string[])[] = [
    headers,
    ...vms.map((vm) => [
      vm.name,
      vm.status,
      vm.backend,
      String(vm.cpuCount),
      `${Math.ceil(vm.memoryMiB / 1024)} GiB`,
      vm.status === "Running"
        ? formatRemainingTtl(vm.expiresAt, currentTimeMillis)
        : "-",
    ]),
  ];
  return padColumns(rows);
};

export const list = Command.make("ls", {}, () =>
  Effect.gen(function* listHandler() {
    const manager = yield* VmManager;
    yield* Console.log(
      formatVmList(yield* manager.list(), yield* Clock.currentTimeMillis)
    );
  })
).pipe(
  Command.withAlias("list"),
  Command.withDescription(
    "List Firecracker VMs with their backend and remaining TTL"
  ),
  Command.withExamples([{ command: "weave ls" }])
);
