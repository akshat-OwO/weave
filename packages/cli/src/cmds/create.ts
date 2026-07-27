import path from "node:path";

import {
  Clock,
  Console,
  Effect,
  FileSystem,
  Match,
  Option,
  Schema,
} from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { resolveVmTemplate } from "../lib/vm-template";
import { scheduleVmTtl } from "../lib/vm-ttl";
import { QemuNotFoundError } from "../schemas/errors/qemu-not-found.schema";
import { TemplateOnExistingVmError } from "../schemas/errors/template-on-existing-vm.schema";
import { VmAlreadyExistsError } from "../schemas/errors/vm-already-exists.schema";
import { Ttl } from "../schemas/ttl.schema";
import { VmName } from "../schemas/vm-name.schema";
import { LimaRuntime } from "../services/lima-runtime";
import { UserConfig } from "../services/user-config";

const PositiveCpuCount = Schema.Int.check(
  Schema.isGreaterThan(0, {
    message: "CPU count must be greater than zero",
  })
);

const defaultCpuCount = Effect.sync(() =>
  Math.max(1, Math.round(navigator.hardwareConcurrency * 0.1))
);

const PositiveMemorySize = Schema.Int.check(
  Schema.isGreaterThan(0, {
    message: "Memory must be greater than zero",
  })
);

const DEFAULT_MEMORY_SIZE_GIB = 2;

const NestedVirtualizationAppleChip = Schema.String.check(
  Schema.isPattern(/^Apple M(?:[3-9]|\d{2,})(?:\s|$)/u)
);

const NestedVirtualizationMacOSVersion = Schema.String.check(
  Schema.isPattern(/^(?:1[5-9]|[2-9]\d|\d{3,})(?:\.|$)/u)
);

const platformCreateArguments = Match.value(process.platform).pipe(
  Match.when("darwin", () => ["--vm-type=vz"]),
  Match.when("linux", () => ["--vm-type=qemu"]),
  Match.when("win32", () => ["--vm-type=qemu"]),
  Match.orElse(() => [])
);

const qemuArchitecture = Match.value(process.arch).pipe(
  Match.when("x64", () => "x86_64"),
  Match.orElse((architecture) => architecture)
);

const ensureWindowsQemuAvailable = Effect.gen(
  function* ensureWindowsQemuAvailableHandler() {
    if (process.platform === "win32") {
      const executable = `qemu-system-${qemuArchitecture}`;
      const environmentName = `QEMU_SYSTEM_${qemuArchitecture.toUpperCase()}`;
      const configuredExecutable = Bun.env[environmentName]?.trim();

      if (configuredExecutable || Bun.which(executable)) {
        return;
      }

      return yield* new QemuNotFoundError({ executable });
    }
  }
);

const nestedVirtualizationArguments = Effect.gen(
  function* nestedVirtualizationArgumentsHandler() {
    if (process.platform !== "darwin" || process.arch !== "arm64") {
      return [];
    }

    const processSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const brand = yield* processSpawner.string(
      ChildProcess.make("/usr/sbin/sysctl", ["-n", "machdep.cpu.brand_string"])
    );
    const macOSVersion = yield* processSpawner.string(
      ChildProcess.make("/usr/bin/sw_vers", ["-productVersion"])
    );
    const isSupportedChip = Option.isSome(
      Schema.decodeUnknownOption(NestedVirtualizationAppleChip)(brand.trim())
    );
    const isSupportedMacOS = Option.isSome(
      Schema.decodeUnknownOption(NestedVirtualizationMacOSVersion)(
        macOSVersion.trim()
      )
    );

    if (!(isSupportedChip && isSupportedMacOS)) {
      yield* Console.warn(
        "Nested virtualization is unavailable; Apple M3 or later with macOS 15 or later is required"
      );
      return [];
    }

    return ["--nested-virt"];
  }
);

const ttl = Flag.string("ttl").pipe(
  Flag.withSchema(Ttl),
  Flag.withDefault(Schema.decodeUnknownSync(Ttl)("10m")),
  Flag.withMetavar("DURATION"),
  Flag.withDescription(
    "Time to live: <number>s, <number>m, <number>h, or <number>d"
  )
);

const cpus = Flag.integer("cpus").pipe(
  Flag.withSchema(PositiveCpuCount),
  Flag.optional,
  Flag.withMetavar("COUNT"),
  Flag.withDescription(
    "Number of virtual CPUs; new VMs default to 10% of host CPUs"
  )
);

const memory = Flag.integer("memory").pipe(
  Flag.withSchema(PositiveMemorySize),
  Flag.optional,
  Flag.withMetavar("GIB"),
  Flag.withDescription("Memory in GiB; new VMs default to 2 GiB")
);

const template = Flag.string("template").pipe(
  Flag.optional,
  Flag.withMetavar("NAME_OR_PATH"),
  Flag.withDescription(
    'VM template: predefined "node" or "python", or a path to a Lima YAML file'
  )
);

const name = Argument.string("name").pipe(
  Argument.withSchema(VmName),
  Argument.withDescription("Unique name for the VM")
);

export const create = Command.make(
  "create",
  { cpus, memory, name, template, ttl },
  ({
    cpus: cpuCount,
    memory: memorySize,
    name: vmName,
    template: vmTemplate,
    ttl: vmTtl,
  }) =>
    Effect.gen(function* createHandler() {
      const startedAt = yield* Clock.currentTimeMillis;
      const fs = yield* FileSystem.FileSystem;
      const lima = yield* LimaRuntime;
      const processSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const userConfig = yield* UserConfig;
      const exists = yield* fs.exists(path.join(userConfig.lima.home, vmName));

      if (exists) {
        if (Option.isSome(vmTemplate)) {
          return yield* new TemplateOnExistingVmError({ name: vmName });
        }

        yield* lima.assertIsolated(vmName);
        const statusCommand = ChildProcess.make(
          userConfig.lima.executable,
          ["list", vmName, "--format={{.Status}}"],
          {
            env: {
              ...Bun.env,
              LIMA_HOME: userConfig.lima.home,
              LIMA_TEMPLATES_PATH: path.join(
                userConfig.lima.runtime,
                "share",
                "lima",
                "templates"
              ),
            },
            extendEnv: true,
          }
        );
        const status = yield* processSpawner.string(statusCommand).pipe(
          Effect.map((output) => output.trim()),
          Effect.flatMap(Schema.decodeUnknownEffect(Schema.NonEmptyString))
        );

        if (status !== "Stopped") {
          return yield* new VmAlreadyExistsError({ name: vmName });
        }

        const cpuArguments = Option.isSome(cpuCount)
          ? [`--cpus=${cpuCount.value}`]
          : [];
        const memoryArguments = Option.isSome(memorySize)
          ? [`--memory=${memorySize.value}`]
          : [];
        yield* ensureWindowsQemuAvailable;
        yield* lima.run(
          [
            "edit",
            "--tty=false",
            "--mount-none",
            ...cpuArguments,
            ...memoryArguments,
            vmName,
          ],
          {
            progress: {
              failureMessage: "Failed to update virtual machine configuration",
              initialMessage: "Updating virtual machine configuration…",
            },
          }
        );
        yield* lima.run(["start", "--tty=false", vmName], {
          progress: {
            failureMessage: "Failed to start virtual machine",
            initialMessage: "Starting virtual machine…",
          },
        });
      } else {
        const newVmCpuCount = Option.isSome(cpuCount)
          ? cpuCount.value
          : yield* defaultCpuCount;
        const newVmMemorySize = Option.isSome(memorySize)
          ? memorySize.value
          : DEFAULT_MEMORY_SIZE_GIB;
        const nestedArguments = yield* nestedVirtualizationArguments;
        const templateArguments = Option.isSome(vmTemplate)
          ? [yield* resolveVmTemplate(vmTemplate.value, userConfig.configPath)]
          : [];
        yield* ensureWindowsQemuAvailable;
        yield* lima.run(
          [
            "start",
            "--tty=false",
            `--name=${vmName}`,
            `--cpus=${newVmCpuCount}`,
            `--memory=${newVmMemorySize}`,
            "--mount-none",
            ...platformCreateArguments,
            ...nestedArguments,
            ...templateArguments,
          ],
          {
            progress: {
              failureMessage: "Failed to start virtual machine",
              initialMessage: "Starting virtual machine…",
            },
          }
        );
      }

      yield* scheduleVmTtl(userConfig.lima.home, vmName, vmTtl);

      const action = exists ? "Started" : "Created";
      const finishedAt = yield* Clock.currentTimeMillis;
      const elapsedSeconds = Math.max(
        0,
        Math.round((finishedAt - startedAt) / 1000)
      );
      yield* Console.log(
        `✔ ${action} ${vmName} in ${elapsedSeconds}s (TTL: ${vmTtl.value})`
      );
    })
).pipe(
  Command.withDescription("Create a new VM or restart a stopped VM"),
  Command.withExamples([
    {
      command: "weave create dev",
      description:
        "Create a VM with 10% of host CPUs, 2 GiB RAM, and a 10m TTL",
    },
    {
      command: "weave create dev --cpus 4 --memory 8 --ttl 1h",
      description: "Create a VM with custom CPUs, memory, and TTL",
    },
    {
      command: "weave create dev --template node",
      description: "Create a VM with Node.js installed through nvm",
    },
    {
      command: "weave create dev --template ./templates/custom.yaml",
      description: "Create a VM from a custom Lima YAML template",
    },
  ])
);
