import path from "node:path";

import { Clock, Console, Context, Effect, Layer, Option } from "effect";

import { FirecrackerHostUnavailableError } from "../schemas/errors/firecracker-host-unavailable.schema";
import { InvalidVmTemplateError } from "../schemas/errors/invalid-vm-template.schema";
import { TemplateOnExistingVmError } from "../schemas/errors/template-on-existing-vm.schema";
import { VmAlreadyExistsError } from "../schemas/errors/vm-already-exists.schema";
import { VmCapacityError } from "../schemas/errors/vm-capacity.schema";
import { VmNetworkCapacityError } from "../schemas/errors/vm-network-capacity.schema";
import { VmNotFoundError } from "../schemas/errors/vm-not-found.schema";
import { VmNotRunningError } from "../schemas/errors/vm-not-running.schema";
import type { Ttl } from "../schemas/ttl.schema";
import type {
  VmBackend,
  VmRecord,
  VmStatus,
} from "../schemas/vm-record.schema";
import { FirecrackerArtifacts } from "./firecracker-artifacts";
import { FirecrackerHost } from "./firecracker-host";
import type { PreparedFirecrackerHost } from "./firecracker-host";
import { VmState } from "./vm-state";
import type { VmStateService } from "./vm-state";

const DEFAULT_ROOTFS_SIZE_GIB = 8;
const PER_VM_MEMORY_OVERHEAD_MIB = 128;
const MINIMUM_NETWORK_SLOT = 2;
const MAXIMUM_NETWORK_SLOT = 254;
const SSH_EXIT_CODES = [0, 255] as const;
const INTERACTIVE_SSH_EXIT_CODES = [0, 100, 130, 255] as const;
const supportedTemplates = ["node", "python"] as const;
type SupportedTemplate = (typeof supportedTemplates)[number];

export interface CreateVmRequest {
  readonly cpuCount: number;
  readonly memoryMiB: number;
  readonly name: string;
  readonly template?: string;
  readonly ttl: Ttl;
}

export interface VmListItem {
  readonly backend: VmBackend;
  readonly cpuCount: number;
  readonly expiresAt: number;
  readonly memoryMiB: number;
  readonly name: string;
  readonly status: VmStatus;
}

export interface VmManagerService {
  readonly create: (
    request: CreateVmRequest
  ) => Effect.Effect<"Created" | "Started", unknown, never>;
  readonly kill: (name: string) => Effect.Effect<void, unknown, never>;
  readonly list: () => Effect.Effect<readonly VmListItem[], unknown, never>;
  readonly shell: (
    name: string,
    command: string
  ) => Effect.Effect<void, unknown, never>;
  readonly ssh: (name: string) => Effect.Effect<void, unknown, never>;
  readonly stop: (name: string) => Effect.Effect<void, unknown, never>;
}

export const VmManager = Context.Service<VmManagerService>(
  "weave/services/vmManager"
);

const isSupportedTemplate = (template: string): template is SupportedTemplate =>
  supportedTemplates.some((candidate) => candidate === template);

const vmPaths = (host: PreparedFirecrackerHost, name: string) => {
  const vmDirectory = path.posix.join(host.paths.root, "vms", name);
  return {
    directory: vmDirectory,
    rootfs: path.posix.join(vmDirectory, "rootfs.ext4"),
  };
};

const jailPaths = (host: PreparedFirecrackerHost, bootId: string) => {
  const chrootBase = path.posix.join(host.paths.root, "jailer");
  const root = path.posix.join(chrootBase, "firecracker", bootId, "root");
  return {
    apiSocket: path.posix.join(root, "run", "firecracker.socket"),
    chrootBase,
    pidFile: path.posix.join(root, "firecracker.pid"),
    root,
  };
};

const sshArguments = (
  host: PreparedFirecrackerHost,
  guestIp: string
): readonly string[] => [
  ...(host.backend === "lima" ? ["sudo"] : []),
  "ssh",
  "-i",
  host.paths.sshPrivateKey,
  "-o",
  "BatchMode=yes",
  "-o",
  "ConnectTimeout=2",
  "-o",
  "ConnectionAttempts=30",
  "-o",
  "StrictHostKeyChecking=no",
  "-o",
  "UserKnownHostsFile=/dev/null",
  "-o",
  "LogLevel=ERROR",
  `root@${guestIp}`,
];

const quotePosixShellArgument = (value: string): string =>
  `'${value.replaceAll("'", "'\"'\"'")}'`;

const remoteShellCommand = (shell: "bash" | "sh", command: string): string =>
  `${shell} -lc ${quotePosixShellArgument(command)}`;

const prepareBaseImage = Effect.fn("weave/services/vmManager/prepareBaseImage")(
  function* prepareBaseImageHandler(host: PreparedFirecrackerHost) {
    const imageDirectory = path.posix.join(host.paths.root, "images");
    const baseRootfs = path.posix.join(imageDirectory, "ubuntu-24.04.ext4");
    const temporaryBaseRootfs = `${baseRootfs}.tmp`;
    if ((yield* host.status(["sudo", "test", "-f", baseRootfs])) === 0) {
      return baseRootfs;
    }

    const extractedRootfs = path.posix.join(imageDirectory, "rootfs-tree");
    yield* Console.log("Preparing the Firecracker base image…");
    yield* host.run([
      "sudo",
      "mkdir",
      "-p",
      imageDirectory,
      path.posix.join(host.paths.root, "vms"),
      path.posix.join(host.paths.root, "jailer"),
    ]);
    yield* host.run([
      "sudo",
      "unsquashfs",
      "-f",
      "-d",
      extractedRootfs,
      host.paths.rootfsSquashfs,
    ]);
    yield* host.run([
      "sudo",
      "install",
      "-d",
      "-m",
      "0700",
      path.posix.join(extractedRootfs, "root", ".ssh"),
    ]);
    yield* host.run([
      "sudo",
      "install",
      "-m",
      "0600",
      host.paths.sshPublicKey,
      path.posix.join(extractedRootfs, "root", ".ssh", "authorized_keys"),
    ]);
    yield* host.run(["sudo", "chown", "-R", "root:root", extractedRootfs]);
    yield* host.run(["sudo", "rm", "-f", temporaryBaseRootfs]);
    yield* host.run([
      "sudo",
      "truncate",
      "-s",
      `${DEFAULT_ROOTFS_SIZE_GIB}G`,
      temporaryBaseRootfs,
    ]);
    yield* host.run([
      "sudo",
      "mkfs.ext4",
      "-d",
      extractedRootfs,
      "-F",
      temporaryBaseRootfs,
    ]);
    yield* host.run(["sudo", "mv", temporaryBaseRootfs, baseRootfs]);
    yield* host.run(["sudo", "rm", "-r", extractedRootfs]);
    return baseRootfs;
  }
);

const allocateNetwork = (
  records: readonly VmRecord[]
): Effect.Effect<VmRecord["network"], VmNetworkCapacityError> =>
  Effect.gen(function* allocateNetworkHandler() {
    const allocated = new Set(records.map(({ network }) => network.slot));
    let slot = MINIMUM_NETWORK_SLOT;
    while (allocated.has(slot) && slot <= MAXIMUM_NETWORK_SLOT) {
      slot += 1;
    }
    if (slot > MAXIMUM_NETWORK_SLOT) {
      return yield* new VmNetworkCapacityError({
        maximumVmCount: MAXIMUM_NETWORK_SLOT - MINIMUM_NETWORK_SLOT + 1,
      });
    }

    const hexadecimalSlot = slot.toString(16).padStart(2, "0");
    return {
      guestIp: `172.30.${slot}.2`,
      hostIp: `172.30.${slot}.1`,
      macAddress: `06:00:AC:1E:${hexadecimalSlot}:02`,
      slot,
      tapDevice: `wv${hexadecimalSlot}`,
    };
  });

const sanitizedBootName = (name: string): string =>
  name.replaceAll(/[^a-zA-Z0-9-]/gu, "-").slice(0, 42);

const makeBootId = (
  name: string,
  networkSlot: number,
  currentTimeMillis: number
): string =>
  `${sanitizedBootName(name)}-${networkSlot.toString(16)}-${currentTimeMillis.toString(36)}`;

const provisionTemplate = Effect.fn(
  "weave/services/vmManager/provisionTemplate"
)(function* provisionTemplateHandler(
  host: PreparedFirecrackerHost,
  record: VmRecord
) {
  if (record.template === null) {
    return;
  }
  if (!isSupportedTemplate(record.template)) {
    return yield* new InvalidVmTemplateError({
      reason: "the stored template is not supported by Firecracker",
      template: record.template,
    });
  }

  const scripts: Record<SupportedTemplate, string> = {
    node: `set -eux -o pipefail
apt-get update
apt-get install -y ca-certificates curl git
export NVM_DIR=/root/.nvm
if [ ! -s "$NVM_DIR/nvm.sh" ]; then
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.4/install.sh | PROFILE=/root/.bashrc bash
fi
. "$NVM_DIR/nvm.sh"
nvm install --lts
nvm alias default 'lts/*'
node --version`,
    python: `set -eux -o pipefail
apt-get update
apt-get install -y ca-certificates curl
curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR=/root/.local/bin UV_NO_MODIFY_PATH=1 sh
/root/.local/bin/uv python install --default
/root/.local/bin/uv --version`,
  };
  yield* host.run([
    ...sshArguments(host, record.network.guestIp),
    remoteShellCommand("bash", scripts[record.template]),
  ]);
});

const configureGuest = Effect.fn("weave/services/vmManager/configureGuest")(
  function* configureGuestHandler(
    host: PreparedFirecrackerHost,
    record: VmRecord,
    ttl: Ttl
  ) {
    const ssh = sshArguments(host, record.network.guestIp);
    yield* host.run([
      ...ssh,
      remoteShellCommand(
        "sh",
        `ip route replace default via ${record.network.hostIp} dev eth0 && printf '%s\\n' 'nameserver 1.1.1.1' 'nameserver 8.8.8.8' > /etc/resolv.conf`
      ),
    ]);
    yield* provisionTemplate(host, record);
    yield* host.run([
      ...ssh,
      "systemd-run",
      "--quiet",
      "--unit=weave-ttl",
      `--on-active=${ttl.seconds}s`,
      "--timer-property=AccuracySec=1s",
      "--collect",
      "systemctl",
      "reboot",
    ]);
  }
);

const configureFirecrackerApi = Effect.fn(
  "weave/services/vmManager/configureFirecrackerApi"
)(function* configureFirecrackerApiHandler(
  host: PreparedFirecrackerHost,
  record: VmRecord,
  apiSocket: string
) {
  const request = (endpoint: string, body: object) =>
    host.run([
      "sudo",
      "curl",
      "--silent",
      "--show-error",
      "--fail",
      "--retry",
      "30",
      "--retry-connrefused",
      "--retry-delay",
      "1",
      "--unix-socket",
      apiSocket,
      "-X",
      "PUT",
      "-H",
      "Content-Type: application/json",
      "--data",
      JSON.stringify(body),
      `http://localhost${endpoint}`,
    ]);

  yield* request("/machine-config", {
    mem_size_mib: record.memoryMiB,
    smt: false,
    vcpu_count: record.cpuCount,
  });
  yield* request("/boot-source", {
    boot_args:
      process.arch === "arm64"
        ? "keep_bootcon console=ttyS0 reboot=k panic=1 pci=off"
        : "console=ttyS0 reboot=k panic=1 pci=off",
    kernel_image_path: "/kernel",
  });
  yield* request("/drives/rootfs", {
    drive_id: "rootfs",
    is_read_only: false,
    is_root_device: true,
    path_on_host: "/rootfs.ext4",
  });
  yield* request("/network-interfaces/net1", {
    guest_mac: record.network.macAddress,
    host_dev_name: record.network.tapDevice,
    iface_id: "net1",
  });
  yield* request("/actions", { action_type: "InstanceStart" });
});

const ensureIptablesRule = Effect.fn(
  "weave/services/vmManager/ensureIptablesRule"
)(function* ensureIptablesRuleHandler(
  host: PreparedFirecrackerHost,
  chain: string,
  rule: readonly string[],
  table?: string,
  insert = false
) {
  const tableArguments = table === undefined ? [] : ["-t", table];
  const common = ["sudo", "iptables", ...tableArguments];
  if ((yield* host.status([...common, "-C", chain, ...rule])) !== 0) {
    yield* host.run([
      ...common,
      insert ? "-I" : "-A",
      chain,
      ...(insert ? ["1"] : []),
      ...rule,
    ]);
  }
});

const startVm = Effect.fn("weave/services/vmManager/startVm")(
  function* startVmHandler(
    host: PreparedFirecrackerHost,
    baseRootfs: string,
    record: VmRecord,
    ttl: Ttl
  ) {
    const { bootId } = record;
    if (bootId === null) {
      return yield* Effect.die("A boot ID is required to start a VM");
    }

    const vm = vmPaths(host, record.name);
    const jail = jailPaths(host, bootId);
    const uid = 20_000 + record.network.slot;
    const account = `weave-vm-${record.network.slot}`;
    yield* host.run(["sudo", "mkdir", "-p", vm.directory]);
    if ((yield* host.status(["sudo", "test", "-f", vm.rootfs])) !== 0) {
      const temporaryRootfs = `${vm.rootfs}.tmp`;
      yield* host.run(["sudo", "rm", "-f", temporaryRootfs]);
      yield* host.run([
        "sudo",
        "cp",
        "--reflink=auto",
        "--sparse=always",
        baseRootfs,
        temporaryRootfs,
      ]);
      yield* host.run(["sudo", "mv", temporaryRootfs, vm.rootfs]);
    }
    yield* host.run([
      "sudo",
      "groupadd",
      "--force",
      "--gid",
      String(uid),
      account,
    ]);
    yield* host.run(
      [
        "sudo",
        "useradd",
        "--system",
        "--no-create-home",
        "--uid",
        String(uid),
        "--gid",
        String(uid),
        account,
      ],
      { acceptableExitCodes: [0, 9] }
    );
    yield* host.run(["sudo", "chown", `${uid}:${uid}`, vm.rootfs]);

    yield* host.run(
      ["sudo", "ip", "link", "delete", record.network.tapDevice],
      { acceptableExitCodes: [0, 1] }
    );
    yield* host.run(
      [
        "sudo",
        "ip",
        "tuntap",
        "add",
        "dev",
        record.network.tapDevice,
        "mode",
        "tap",
        "user",
        String(uid),
      ],
      { acceptableExitCodes: [0, 2] }
    );
    yield* host.run(
      [
        "sudo",
        "ip",
        "addr",
        "add",
        `${record.network.hostIp}/30`,
        "dev",
        record.network.tapDevice,
      ],
      { acceptableExitCodes: [0, 2] }
    );
    yield* host.run([
      "sudo",
      "ip",
      "link",
      "set",
      record.network.tapDevice,
      "up",
    ]);
    yield* host.run(["sudo", "sysctl", "-w", "net.ipv4.ip_forward=1"]);
    yield* ensureIptablesRule(
      host,
      "POSTROUTING",
      ["-s", "172.30.0.0/16", "-j", "MASQUERADE"],
      "nat"
    );
    for (const destination of [
      "10.0.0.0/8",
      "169.254.0.0/16",
      "172.16.0.0/12",
      "192.168.0.0/16",
    ]) {
      yield* ensureIptablesRule(
        host,
        "FORWARD",
        ["-i", record.network.tapDevice, "-d", destination, "-j", "REJECT"],
        undefined,
        true
      );
    }
    yield* ensureIptablesRule(
      host,
      "INPUT",
      ["-i", record.network.tapDevice, "-j", "REJECT"],
      undefined,
      true
    );
    yield* ensureIptablesRule(
      host,
      "INPUT",
      [
        "-i",
        record.network.tapDevice,
        "-m",
        "conntrack",
        "--ctstate",
        "RELATED,ESTABLISHED",
        "-j",
        "ACCEPT",
      ],
      undefined,
      true
    );
    yield* ensureIptablesRule(host, "FORWARD", [
      "-o",
      record.network.tapDevice,
      "-m",
      "conntrack",
      "--ctstate",
      "RELATED,ESTABLISHED",
      "-j",
      "ACCEPT",
    ]);
    yield* ensureIptablesRule(host, "FORWARD", [
      "-i",
      record.network.tapDevice,
      "-j",
      "ACCEPT",
    ]);

    const memoryLimitBytes =
      (record.memoryMiB + PER_VM_MEMORY_OVERHEAD_MIB) * 1024 ** 2;
    const cgroupArguments =
      (yield* host.status([
        "test",
        "-f",
        "/sys/fs/cgroup/cgroup.controllers",
      ])) === 0
        ? [
            "--cgroup-version",
            "2",
            "--cgroup",
            `memory.max=${memoryLimitBytes}`,
            "--cgroup",
            `cpu.max=${record.cpuCount * 100_000} 100000`,
          ]
        : [
            "--cgroup-version",
            "1",
            "--cgroup",
            `memory.limit_in_bytes=${memoryLimitBytes}`,
            "--cgroup",
            "cpu.cfs_period_us=100000",
            "--cgroup",
            `cpu.cfs_quota_us=${record.cpuCount * 100_000}`,
          ];
    yield* host.run([
      "sudo",
      host.paths.jailer,
      "--id",
      bootId,
      "--exec-file",
      host.paths.firecracker,
      "--uid",
      String(uid),
      "--gid",
      String(uid),
      "--chroot-base-dir",
      jail.chrootBase,
      ...cgroupArguments,
      "--daemonize",
      "--new-pid-ns",
      "--",
      "--api-sock",
      "/run/firecracker.socket",
    ]);
    yield* host.run([
      "sudo",
      "install",
      "-o",
      String(uid),
      "-g",
      String(uid),
      "-m",
      "0400",
      host.paths.kernel,
      path.posix.join(jail.root, "kernel"),
    ]);
    yield* host.run([
      "sudo",
      "ln",
      vm.rootfs,
      path.posix.join(jail.root, "rootfs.ext4"),
    ]);
    yield* configureFirecrackerApi(host, record, jail.apiSocket);
    yield* configureGuest(host, record, ttl);
  }
);

const stopVm = Effect.fn("weave/services/vmManager/stopVm")(
  function* stopVmHandler(host: PreparedFirecrackerHost, record: VmRecord) {
    yield* host.run(
      [...sshArguments(host, record.network.guestIp), "systemctl", "reboot"],
      { acceptableExitCodes: SSH_EXIT_CODES }
    );
    yield* host.run(
      ["sudo", "ip", "link", "delete", record.network.tapDevice],
      { acceptableExitCodes: [0, 1] }
    );
  }
);

const cleanupFailedStart = Effect.fn(
  "weave/services/vmManager/cleanupFailedStart"
)(function* cleanupFailedStartHandler(
  host: PreparedFirecrackerHost,
  record: VmRecord
) {
  if (record.bootId !== null) {
    const jail = jailPaths(host, record.bootId);
    yield* host.run(["sudo", "pkill", "-F", jail.pidFile], {
      acceptableExitCodes: [0, 1],
    });
    yield* host.run(["sudo", "rm", "-r", "-f", path.posix.dirname(jail.root)], {
      acceptableExitCodes: [0, 1],
    });
  }
  yield* host.run(["sudo", "ip", "link", "delete", record.network.tapDevice], {
    acceptableExitCodes: [0, 1],
  });
});

const requireVm = Effect.fn("weave/services/vmManager/requireVm")(
  function* requireVmHandler(vmState: VmStateService, name: string) {
    const record = yield* vmState.get(name);
    if (Option.isNone(record)) {
      return yield* new VmNotFoundError({ name });
    }
    return record.value;
  }
);

const requireRunningVm = Effect.fn("weave/services/vmManager/requireRunningVm")(
  function* requireRunningVmHandler(vmState: VmStateService, name: string) {
    const record = yield* requireVm(vmState, name);
    const now = yield* Clock.currentTimeMillis;
    if (record.status !== "Running" || record.expiresAt <= now) {
      return yield* new VmNotRunningError({ name });
    }
    return record;
  }
);

export const VmManagerLive = Layer.effect(
  VmManager,
  Effect.gen(function* vmManagerHandler() {
    const artifacts = yield* FirecrackerArtifacts;
    const firecrackerHost = yield* FirecrackerHost;
    const vmState = yield* VmState;
    const prepareHost = Effect.fn("weave/services/vmManager/prepareHost")(
      function* prepareHostHandler(backend?: VmBackend) {
        const detectedBackend = yield* firecrackerHost.check();
        if (backend !== undefined && backend !== detectedBackend) {
          return yield* new FirecrackerHostUnavailableError({
            reason: `the "${backend}" backend that owns this VM is unavailable`,
          });
        }
        return yield* firecrackerHost.prepare(
          yield* artifacts.ensure(),
          backend
        );
      }
    );

    return VmManager.of({
      create: (request) =>
        vmState.withLock(
          Effect.gen(function* createHandler() {
            const now = yield* Clock.currentTimeMillis;
            const existing = yield* vmState.get(request.name);
            if (
              Option.isSome(existing) &&
              existing.value.status === "Running" &&
              existing.value.expiresAt > now
            ) {
              return yield* new VmAlreadyExistsError({ name: request.name });
            }
            if (Option.isSome(existing) && request.template !== undefined) {
              return yield* new TemplateOnExistingVmError({
                name: request.name,
              });
            }
            if (
              request.template !== undefined &&
              !isSupportedTemplate(request.template)
            ) {
              return yield* new InvalidVmTemplateError({
                reason:
                  "Firecracker templates must currently be either node or python; Lima YAML templates are no longer supported",
                template: request.template,
              });
            }

            const host = yield* prepareHost(
              Option.isSome(existing) ? existing.value.backend : undefined
            );
            const records = yield* vmState.list();
            const running = records.filter(
              (record) =>
                record.status === "Running" &&
                record.expiresAt > now &&
                record.name !== request.name
            );
            const reservedCpuCount = running.reduce(
              (total, record) => total + record.cpuCount,
              0
            );
            const reservedMemoryMiB = running.reduce(
              (total, record) =>
                total + record.memoryMiB + PER_VM_MEMORY_OVERHEAD_MIB,
              0
            );
            const availableCpuCount = host.capacity.cpuCount - reservedCpuCount;
            const availableMemoryMiB = Math.max(
              0,
              host.capacity.memoryMiB -
                reservedMemoryMiB -
                PER_VM_MEMORY_OVERHEAD_MIB
            );
            if (
              request.cpuCount > availableCpuCount ||
              request.memoryMiB > availableMemoryMiB
            ) {
              return yield* new VmCapacityError({
                availableCpuCount,
                availableMemoryMiB,
                requestedCpuCount: request.cpuCount,
                requestedMemoryMiB: request.memoryMiB,
              });
            }

            const baseRootfs = yield* prepareBaseImage(host);
            const action = Option.isSome(existing) ? "Started" : "Created";
            if (Option.isSome(existing) && existing.value.bootId !== null) {
              const previousJail = jailPaths(host, existing.value.bootId);
              yield* host.run(
                [
                  "sudo",
                  "rm",
                  "-r",
                  "-f",
                  path.posix.dirname(previousJail.root),
                ],
                { acceptableExitCodes: [0, 1] }
              );
            }
            const network = Option.isSome(existing)
              ? existing.value.network
              : yield* allocateNetwork(records);
            const record: VmRecord = {
              backend: host.backend,
              bootId: makeBootId(request.name, network.slot, now),
              cpuCount: request.cpuCount,
              createdAt: Option.isSome(existing)
                ? existing.value.createdAt
                : now,
              expiresAt: now + request.ttl.seconds * 1000,
              memoryMiB: request.memoryMiB,
              name: request.name,
              network,
              status: "Running",
              template: Option.isSome(existing)
                ? existing.value.template
                : (request.template ?? null),
              version: 1,
            };
            yield* startVm(host, baseRootfs, record, request.ttl).pipe(
              Effect.onError(() =>
                cleanupFailedStart(host, record).pipe(Effect.ignore)
              )
            );
            yield* vmState.write(record);
            return action;
          })
        ),
      kill: (name) =>
        vmState.withLock(
          Effect.gen(function* killHandler() {
            const record = yield* requireVm(vmState, name);
            const host = yield* prepareHost(record.backend);
            if (
              record.status === "Running" &&
              record.expiresAt > (yield* Clock.currentTimeMillis)
            ) {
              yield* stopVm(host, record);
            }
            const vm = vmPaths(host, record.name);
            yield* host.run(
              ["sudo", "ip", "link", "delete", record.network.tapDevice],
              { acceptableExitCodes: [0, 1] }
            );
            if (record.bootId !== null) {
              yield* host.run(
                [
                  "sudo",
                  "rm",
                  "-r",
                  "-f",
                  path.posix.dirname(jailPaths(host, record.bootId).root),
                ],
                { acceptableExitCodes: [0, 1] }
              );
            }
            yield* host.run(["sudo", "rm", "-r", "-f", vm.directory]);
            yield* vmState.remove(name);
          })
        ),
      list: () =>
        Effect.gen(function* listHandler() {
          const now = yield* Clock.currentTimeMillis;
          const records = yield* vmState.list();
          return records.map((record) => ({
            backend: record.backend,
            cpuCount: record.cpuCount,
            expiresAt: record.expiresAt,
            memoryMiB: record.memoryMiB,
            name: record.name,
            status:
              record.status === "Running" && record.expiresAt <= now
                ? "Stopped"
                : record.status,
          }));
        }),
      shell: (name, command) =>
        Effect.gen(function* shellHandler() {
          const record = yield* requireRunningVm(vmState, name);
          const host = yield* prepareHost(record.backend);
          yield* host.run([
            ...sshArguments(host, record.network.guestIp),
            remoteShellCommand("sh", command),
          ]);
        }),
      ssh: (name) =>
        Effect.gen(function* sshHandler() {
          const record = yield* requireRunningVm(vmState, name);
          const host = yield* prepareHost(record.backend);
          yield* host.run(sshArguments(host, record.network.guestIp), {
            acceptableExitCodes: INTERACTIVE_SSH_EXIT_CODES,
          });
        }),
      stop: (name) =>
        vmState.withLock(
          Effect.gen(function* stopHandler() {
            const record = yield* requireVm(vmState, name);
            const host = yield* prepareHost(record.backend);
            const isRunning =
              record.status === "Running" &&
              record.expiresAt > (yield* Clock.currentTimeMillis);
            const stopEffect = isRunning
              ? stopVm(host, record)
              : host.run(
                  ["sudo", "ip", "link", "delete", record.network.tapDevice],
                  { acceptableExitCodes: [0, 1] }
                );
            yield* stopEffect;
            yield* vmState.write({
              ...record,
              status: "Stopped",
            });
          })
        ),
    });
  })
);
