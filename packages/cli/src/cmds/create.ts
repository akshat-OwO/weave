import { Clock, Console, Effect, Option, Schema } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";

import { Ttl } from "../schemas/ttl.schema";
import { VmName } from "../schemas/vm-name.schema";
import { VmManager } from "../services/vm-manager";

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
const MEBIBYTES_PER_GIBIBYTE = 1024;

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
    "Number of Firecracker vCPUs; new VMs default to 10% of host CPUs"
  )
);

const memory = Flag.integer("memory").pipe(
  Flag.withSchema(PositiveMemorySize),
  Flag.optional,
  Flag.withMetavar("GIB"),
  Flag.withDescription("Firecracker memory in GiB; new VMs default to 2 GiB")
);

const template = Flag.string("template").pipe(
  Flag.optional,
  Flag.withMetavar("NAME"),
  Flag.withDescription('Firecracker VM template: "node" or "python"')
);

const name = Argument.string("name").pipe(
  Argument.withSchema(VmName),
  Argument.withDescription("Unique name for the Firecracker VM")
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
      const manager = yield* VmManager;
      const action = yield* manager.create({
        cpuCount: Option.isSome(cpuCount)
          ? cpuCount.value
          : yield* defaultCpuCount,
        memoryMiB:
          (Option.isSome(memorySize)
            ? memorySize.value
            : DEFAULT_MEMORY_SIZE_GIB) * MEBIBYTES_PER_GIBIBYTE,
        name: vmName,
        template: Option.getOrUndefined(vmTemplate),
        ttl: vmTtl,
      });
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
  Command.withDescription("Create and start an isolated Firecracker microVM"),
  Command.withExamples([
    {
      command: "weave create dev",
      description:
        "Create a Firecracker VM with 10% of host CPUs, 2 GiB RAM, and a 10m TTL",
    },
    {
      command: "weave create dev --cpus 4 --memory 8 --ttl 1h",
      description: "Create a VM with custom CPUs, memory, and TTL",
    },
    {
      command: "weave create dev --template node",
      description: "Create a VM and provision Node.js",
    },
  ])
);
