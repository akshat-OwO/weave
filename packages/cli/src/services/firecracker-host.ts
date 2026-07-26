import os from "node:os";
import path from "node:path";

import type { PlatformError } from "effect";
import { Context, Effect, FileSystem, Layer } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { CommandExecutionError } from "../schemas/errors/command-execution.schema";
import { FirecrackerHostUnavailableError } from "../schemas/errors/firecracker-host-unavailable.schema";
import type { VmBackend } from "../schemas/vm-record.schema";
import type { FirecrackerArtifactPaths } from "./firecracker-artifacts";
import { LimaRuntime } from "./lima-runtime";
import type { LimaRuntimeService } from "./lima-runtime";
import { UserConfig } from "./user-config";
import type { UserConfigService } from "./user-config";

const LIMA_INSTANCE_NAME = "weave-lima-vm";
const APPLE_NESTED_VIRTUALIZATION_CHIP = /^Apple M(?:[3-9]|\d{2,})(?:\s|$)/u;
const MACOS_NESTED_VIRTUALIZATION_VERSION =
  /^(?:1[5-9]|[2-9]\d|\d{3,})(?:\.|$)/u;
const LIMA_RUNTIME_ROOT = "/var/lib/weave";
const LIMA_FIXED_MEMORY_RESERVE_MIB = 1024;

interface RunOptions {
  readonly acceptableExitCodes?: readonly number[];
}

export interface PreparedFirecrackerHost {
  readonly backend: VmBackend;
  readonly capacity: {
    readonly cpuCount: number;
    readonly memoryMiB: number;
  };
  readonly capture: (
    args: readonly string[]
  ) => Effect.Effect<
    string,
    CommandExecutionError | PlatformError.PlatformError,
    never
  >;
  readonly paths: {
    readonly firecracker: string;
    readonly jailer: string;
    readonly kernel: string;
    readonly root: string;
    readonly rootfsSquashfs: string;
    readonly sshPrivateKey: string;
    readonly sshPublicKey: string;
  };
  readonly run: (
    args: readonly string[],
    options?: RunOptions
  ) => Effect.Effect<
    void,
    CommandExecutionError | PlatformError.PlatformError,
    never
  >;
  readonly status: (
    args: readonly string[]
  ) => Effect.Effect<number, PlatformError.PlatformError, never>;
}

export const FirecrackerHost = Context.Service<{
  readonly check: () => Effect.Effect<
    VmBackend,
    FirecrackerHostUnavailableError | PlatformError.PlatformError,
    never
  >;
  readonly prepare: (
    artifacts: FirecrackerArtifactPaths,
    backend?: VmBackend
  ) => Effect.Effect<
    PreparedFirecrackerHost,
    | CommandExecutionError
    | FirecrackerHostUnavailableError
    | PlatformError.PlatformError,
    never
  >;
}>("weave/services/firecrackerHost");

const directKvmAvailable = Effect.fn(
  "weave/services/firecrackerHost/directKvmAvailable"
)(function* directKvmAvailableHandler(fs: FileSystem.FileSystem) {
  if (
    process.platform !== "linux" ||
    (process.arch !== "x64" && process.arch !== "arm64")
  ) {
    return false;
  }

  if (!(yield* fs.exists("/dev/kvm"))) {
    return false;
  }

  return yield* fs.open("/dev/kvm", { flag: "r+" }).pipe(
    Effect.as(true),
    Effect.catch(() => Effect.succeed(false)),
    Effect.scoped
  );
});

const nestedVirtualizationSupported = Effect.fn(
  "weave/services/firecrackerHost/nestedVirtualizationSupported"
)(function* nestedVirtualizationSupportedHandler(
  processSpawner: ChildProcessSpawner.ChildProcessSpawner["Service"]
) {
  if (process.platform !== "darwin" || process.arch !== "arm64") {
    return false;
  }

  const [brand, version] = yield* Effect.all([
    processSpawner.string(
      ChildProcess.make("/usr/sbin/sysctl", ["-n", "machdep.cpu.brand_string"])
    ),
    processSpawner.string(
      ChildProcess.make("/usr/bin/sw_vers", ["-productVersion"])
    ),
  ]);

  return (
    APPLE_NESTED_VIRTUALIZATION_CHIP.test(brand.trim()) &&
    MACOS_NESTED_VIRTUALIZATION_VERSION.test(version.trim())
  );
});

const directRun = (
  processSpawner: ChildProcessSpawner.ChildProcessSpawner["Service"],
  args: readonly string[],
  options?: RunOptions
) =>
  Effect.gen(function* directRunHandler() {
    const [executable, ...commandArguments] = args;
    if (executable === undefined) {
      return;
    }

    const exitCode = yield* processSpawner.exitCode(
      ChildProcess.make(executable, commandArguments, {
        stderr: "inherit",
        stdin: "inherit",
        stdout: "inherit",
      })
    );
    if (!(options?.acceptableExitCodes ?? [0]).includes(exitCode)) {
      return yield* new CommandExecutionError({
        backend: "native host",
        command: args.map((argument) => JSON.stringify(argument)).join(" "),
        exitCode,
      });
    }
  });

const directCapture = (
  processSpawner: ChildProcessSpawner.ChildProcessSpawner["Service"],
  args: readonly string[]
) => {
  const [executable, ...commandArguments] = args;
  if (executable === undefined) {
    return Effect.succeed("");
  }
  return processSpawner.string(
    ChildProcess.make(executable, commandArguments, {
      stderr: "pipe",
      stdin: "ignore",
      stdout: "pipe",
    })
  );
};

const directStatus = (
  processSpawner: ChildProcessSpawner.ChildProcessSpawner["Service"],
  args: readonly string[]
) => {
  const [executable, ...commandArguments] = args;
  if (executable === undefined) {
    return Effect.succeed(0);
  }
  return processSpawner.exitCode(
    ChildProcess.make(executable, commandArguments, {
      stderr: "ignore",
      stdin: "ignore",
      stdout: "ignore",
    })
  );
};

const ensureLimaTemplate = Effect.fn(
  "weave/services/firecrackerHost/ensureLimaTemplate"
)(function* ensureLimaTemplateHandler(
  fs: FileSystem.FileSystem,
  configPath: string
) {
  const templatePath = path.join(configPath, "weave-lima-vm.yaml");
  if (yield* fs.exists(templatePath)) {
    return templatePath;
  }

  const template = `minimumLimaVersion: 2.2.0
base:
  - template:default
mounts: []
containerd:
  system: false
  user: false
provision:
  - mode: system
    script: |
      #!/bin/sh
      set -eu
      export DEBIAN_FRONTEND=noninteractive
      apt-get update
      apt-get install -y curl e2fsprogs iproute2 iptables openssh-client procps squashfs-tools
      install -d -m 0755 /var/lib/weave
`;
  yield* fs.writeFileString(templatePath, template);
  return templatePath;
});

const ensureLimaHost = Effect.fn(
  "weave/services/firecrackerHost/ensureLimaHost"
)(function* ensureLimaHostHandler(
  fs: FileSystem.FileSystem,
  lima: LimaRuntimeService,
  userConfig: UserConfigService
) {
  yield* userConfig.initLima();
  const instanceDirectory = path.join(userConfig.lima.home, LIMA_INSTANCE_NAME);
  if (yield* fs.exists(instanceDirectory)) {
    const instanceStatus = yield* lima.capture([
      "list",
      LIMA_INSTANCE_NAME,
      "--format={{.Status}}",
    ]);
    if (instanceStatus.stdout.trim() === "Running") {
      return;
    }
    yield* lima.run(["start", "--tty=false", LIMA_INSTANCE_NAME]);
    return;
  }

  const templatePath = yield* ensureLimaTemplate(fs, userConfig.configPath);
  const cpuCount = Math.max(
    2,
    Math.floor(navigator.hardwareConcurrency * 0.75)
  );
  const memoryGiB = Math.max(4, Math.floor(os.totalmem() / 1024 ** 3 / 1.5));
  yield* lima.run(
    [
      "start",
      "--tty=false",
      `--name=${LIMA_INSTANCE_NAME}`,
      `--cpus=${cpuCount}`,
      `--memory=${memoryGiB}`,
      "--disk=100",
      "--mount-none",
      "--vm-type=vz",
      "--nested-virt",
      templatePath,
    ],
    {
      progress: {
        failureMessage: "Failed to start the Firecracker host",
        initialMessage: "Starting the Firecracker host…",
      },
    }
  );
});

const ensureLimaPrerequisites = Effect.fn(
  "weave/services/firecrackerHost/ensureLimaPrerequisites"
)(function* ensureLimaPrerequisitesHandler(lima: LimaRuntimeService) {
  if (
    (yield* lima.status([
      "shell",
      LIMA_INSTANCE_NAME,
      "--",
      "sh",
      "-c",
      "command -v curl >/dev/null && command -v ip >/dev/null && command -v iptables >/dev/null && command -v mkfs.ext4 >/dev/null && command -v pkill >/dev/null && command -v ssh >/dev/null && command -v unsquashfs >/dev/null",
    ])) === 0
  ) {
    return;
  }

  yield* lima.run([
    "shell",
    LIMA_INSTANCE_NAME,
    "--",
    "sudo",
    "apt-get",
    "update",
  ]);
  yield* lima.run([
    "shell",
    LIMA_INSTANCE_NAME,
    "--",
    "sudo",
    "apt-get",
    "install",
    "-y",
    "curl",
    "e2fsprogs",
    "iproute2",
    "iptables",
    "openssh-client",
    "procps",
    "squashfs-tools",
  ]);
});

const copyArtifactToLima = Effect.fn(
  "weave/services/firecrackerHost/copyArtifactToLima"
)(function* copyArtifactToLimaHandler(
  lima: LimaRuntimeService,
  source: string,
  destination: string,
  mode: string
) {
  if (
    (yield* lima.status([
      "shell",
      LIMA_INSTANCE_NAME,
      "--",
      "sudo",
      "test",
      "-f",
      destination,
    ])) === 0
  ) {
    return;
  }

  const fileName = path.basename(destination);
  const temporaryPath = `/tmp/${fileName}`;
  yield* lima.run(["copy", source, `${LIMA_INSTANCE_NAME}:${temporaryPath}`]);
  yield* lima.run([
    "shell",
    LIMA_INSTANCE_NAME,
    "--",
    "sudo",
    "install",
    "-m",
    mode,
    temporaryPath,
    destination,
  ]);
});

export const FirecrackerHostLive = Layer.effect(
  FirecrackerHost,
  Effect.gen(function* firecrackerHostHandler() {
    const fs = yield* FileSystem.FileSystem;
    const lima = yield* LimaRuntime;
    const processSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const userConfig = yield* UserConfig;
    const check = Effect.fn("weave/services/firecrackerHost/check")(
      function* checkHandler() {
        if (Bun.which("ssh-keygen") === null) {
          return yield* new FirecrackerHostUnavailableError({
            reason: 'the required "ssh-keygen" executable is unavailable',
          });
        }

        if (yield* directKvmAvailable(fs)) {
          const missing = [
            "curl",
            "ip",
            "iptables",
            "mkfs.ext4",
            "pkill",
            "ssh",
            "sudo",
            "unsquashfs",
          ].filter((executable) => Bun.which(executable) === null);
          if (missing.length > 0) {
            return yield* new FirecrackerHostUnavailableError({
              reason: `the native Linux host is missing required executables: ${missing.join(", ")}`,
            });
          }
          return "native" as const;
        }

        if (yield* nestedVirtualizationSupported(processSpawner)) {
          return "lima" as const;
        }
        return yield* new FirecrackerHostUnavailableError({
          reason:
            "this machine has neither usable native KVM nor a supported Apple M3-or-later Lima nested-virtualization path",
        });
      }
    );

    return FirecrackerHost.of({
      check,
      prepare: (artifacts, requestedBackend) =>
        Effect.gen(function* prepareHandler() {
          const backend = yield* check();
          if (requestedBackend !== undefined && requestedBackend !== backend) {
            return yield* new FirecrackerHostUnavailableError({
              reason: `the "${requestedBackend}" backend that owns this VM is unavailable`,
            });
          }
          if (backend === "native") {
            const root = `/var/lib/weave/${process.getuid?.() ?? 0}`;
            yield* directRun(processSpawner, ["sudo", "mkdir", "-p", root]);
            return {
              backend: "native",
              capacity: {
                cpuCount: Math.max(
                  1,
                  Math.floor(navigator.hardwareConcurrency * 0.75)
                ),
                memoryMiB: Math.max(
                  2048,
                  Math.floor(os.totalmem() / 1024 ** 2 / 1.5)
                ),
              },
              capture: (args) => directCapture(processSpawner, args),
              paths: {
                firecracker: artifacts.firecracker,
                jailer: artifacts.jailer,
                kernel: artifacts.kernel,
                root,
                rootfsSquashfs: artifacts.rootfsSquashfs,
                sshPrivateKey: artifacts.sshPrivateKey,
                sshPublicKey: artifacts.sshPublicKey,
              },
              run: (args, options) => directRun(processSpawner, args, options),
              status: (args) => directStatus(processSpawner, args),
            } satisfies PreparedFirecrackerHost;
          }

          yield* ensureLimaHost(fs, lima, userConfig);
          yield* ensureLimaPrerequisites(lima);
          if (
            (yield* lima.status([
              "shell",
              LIMA_INSTANCE_NAME,
              "--",
              "sudo",
              "sh",
              "-c",
              "test -r /dev/kvm && test -w /dev/kvm",
            ])) !== 0
          ) {
            return yield* new FirecrackerHostUnavailableError({
              reason:
                'the Lima host does not expose a usable nested "/dev/kvm" device',
            });
          }
          const runtimeDirectory = `${LIMA_RUNTIME_ROOT}/runtime/${path.basename(path.dirname(artifacts.firecracker))}`;
          yield* lima.run([
            "shell",
            LIMA_INSTANCE_NAME,
            "--",
            "sudo",
            "mkdir",
            "-p",
            runtimeDirectory,
          ]);
          const remotePaths = {
            firecracker: `${runtimeDirectory}/firecracker`,
            jailer: `${runtimeDirectory}/jailer`,
            kernel: `${runtimeDirectory}/${path.basename(artifacts.kernel)}`,
            root: LIMA_RUNTIME_ROOT,
            rootfsSquashfs: `${runtimeDirectory}/${path.basename(artifacts.rootfsSquashfs)}`,
            sshPrivateKey: `${runtimeDirectory}/id_ed25519`,
            sshPublicKey: `${runtimeDirectory}/id_ed25519.pub`,
          };
          for (const [source, destination, mode] of [
            [artifacts.firecracker, remotePaths.firecracker, "0755"],
            [artifacts.jailer, remotePaths.jailer, "0755"],
            [artifacts.kernel, remotePaths.kernel, "0644"],
            [artifacts.rootfsSquashfs, remotePaths.rootfsSquashfs, "0644"],
            [artifacts.sshPrivateKey, remotePaths.sshPrivateKey, "0600"],
            [artifacts.sshPublicKey, remotePaths.sshPublicKey, "0644"],
          ] as const) {
            yield* copyArtifactToLima(lima, source, destination, mode);
          }
          const outerCpuCount = Math.max(
            2,
            Math.floor(navigator.hardwareConcurrency * 0.75)
          );
          const outerMemoryMiB =
            Math.max(4, Math.floor(os.totalmem() / 1024 ** 3 / 1.5)) * 1024;
          return {
            backend: "lima",
            capacity: {
              cpuCount: Math.max(1, outerCpuCount - 1),
              memoryMiB: Math.max(
                2048,
                outerMemoryMiB -
                  Math.max(
                    LIMA_FIXED_MEMORY_RESERVE_MIB,
                    Math.ceil(outerMemoryMiB * 0.1)
                  )
              ),
            },
            capture: (args) =>
              lima
                .capture(["shell", LIMA_INSTANCE_NAME, "--", ...args])
                .pipe(Effect.map(({ stdout }) => stdout)),
            paths: remotePaths,
            run: (args, options) =>
              lima.run(["shell", LIMA_INSTANCE_NAME, "--", ...args], options),
            status: (args) =>
              lima.status(["shell", LIMA_INSTANCE_NAME, "--", ...args]),
          } satisfies PreparedFirecrackerHost;
        }),
    });
  })
);

export const firecrackerHostName = LIMA_INSTANCE_NAME;
