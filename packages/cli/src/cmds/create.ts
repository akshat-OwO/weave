import path from "node:path";

import { Console, Effect, FileSystem, Match, Option, Schema } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { resolveVmTemplate } from "../lib/vm-template";
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
  { cpus, name, template, ttl },
  ({ cpus: cpuCount, name: vmName, template: vmTemplate, ttl: vmTtl }) =>
    Effect.gen(function* createHandler() {
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
        yield* ensureWindowsQemuAvailable;
        yield* lima.run([
          "edit",
          "--tty=false",
          "--mount-none",
          ...cpuArguments,
          vmName,
        ]);
        yield* lima.run(["start", "--tty=false", vmName]);
      } else {
        const newVmCpuCount = Option.isSome(cpuCount)
          ? cpuCount.value
          : yield* defaultCpuCount;
        const nestedArguments = yield* nestedVirtualizationArguments;
        const templateArguments = Option.isSome(vmTemplate)
          ? [yield* resolveVmTemplate(vmTemplate.value, userConfig.configPath)]
          : [];
        yield* ensureWindowsQemuAvailable;
        yield* lima.run([
          "start",
          "--tty=false",
          `--name=${vmName}`,
          `--cpus=${newVmCpuCount}`,
          "--mount-none",
          ...platformCreateArguments,
          ...nestedArguments,
          ...templateArguments,
        ]);
      }

      const expireCommand = `nohup sh -c 'sleep ${vmTtl.seconds}; sudo poweroff' >/dev/null 2>&1 </dev/null &`;
      yield* lima.run(["shell", vmName, "--", "sh", "-lc", expireCommand]);

      const action = exists ? "Started" : "Created";
      yield* Console.log(`${action} ${vmName} (TTL: ${vmTtl.value})`);
    })
).pipe(
  Command.withDescription(
    "Create and start an isolated VM with no host directories mounted"
  ),
  Command.withExamples([
    {
      command: "weave create dev",
      description: "Create a named VM with smart CPU defaults and a 10m TTL",
    },
    {
      command: "weave create dev --cpus 4 --ttl 1h",
      description: "Create a named VM with custom CPUs and TTL",
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
