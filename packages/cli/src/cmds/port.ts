import path from "node:path";

import { Clock, Console, Effect, FileSystem, Option } from "effect";
import { Argument, Command } from "effect/unstable/cli";

import { withVmLock } from "../lib/vm-lock";
import {
  limaNetworkArguments,
  readVmNetwork,
  writeVmNetwork,
} from "../lib/vm-network";
import { readVmTtl, scheduleVmTtlAt } from "../lib/vm-ttl";
import { PortAlreadyPublishedError } from "../schemas/errors/port-already-published.schema";
import { PortNotPublishedError } from "../schemas/errors/port-not-published.schema";
import { VmLifecycleStateError } from "../schemas/errors/vm-lifecycle-state.schema";
import { VmNotFoundError } from "../schemas/errors/vm-not-found.schema";
import {
  PortMappingArgument,
  PortNumber,
} from "../schemas/port-mapping.schema";
import type { PortMapping } from "../schemas/port-mapping.schema";
import { VmName } from "../schemas/vm-name.schema";
import { LimaRuntime } from "../services/lima-runtime";
import { UserConfig } from "../services/user-config";

const vmName = Argument.string("name").pipe(
  Argument.withSchema(VmName),
  Argument.withDescription("Name of the VM")
);

const editVmNetwork = (
  name: string,
  ports: readonly PortMapping[],
  failureMessage: string,
  initialMessage: string
) =>
  LimaRuntime.use((lima) =>
    lima.run(["edit", "--tty=false", ...limaNetworkArguments(ports), name], {
      progress: {
        failureMessage,
        initialMessage,
      },
    })
  );

const startVm = (name: string) =>
  LimaRuntime.use((lima) =>
    lima.run(["start", "--tty=false", "--progress", name], {
      progress: {
        failureMessage: `Failed to restart ${name}`,
        initialMessage: `Restarting ${name}…`,
      },
    })
  );

const stopVm = (name: string) =>
  LimaRuntime.use((lima) =>
    lima.run(["stop", "--tty=false", name], {
      progress: {
        failureMessage: `Failed to stop ${name}`,
        initialMessage: `Stopping ${name} to update port mappings…`,
      },
    })
  );

const restoreTtl = (
  limaHome: string,
  name: string,
  expiresAt: Option.Option<number>
) =>
  Option.match(expiresAt, {
    onNone: () => Effect.void,
    onSome: (value) => scheduleVmTtlAt(limaHome, name, value),
  });

const restoreRunningVm = (
  limaHome: string,
  name: string,
  ports: readonly PortMapping[],
  expiresAt: Option.Option<number>
) =>
  Effect.gen(function* restoreRunningVmHandler() {
    const lima = yield* LimaRuntime;
    const { stdout } = yield* lima.capture([
      "list",
      name,
      "--format={{.Status}}",
    ]);
    if (stdout.trim() === "Running") {
      yield* stopVm(name);
    }
    yield* editVmNetwork(
      name,
      ports,
      `Failed to restore port mappings for ${name}`,
      `Restoring port mappings for ${name}…`
    );
    yield* startVm(name);
    yield* restoreTtl(limaHome, name, expiresAt);
  }).pipe(Effect.ignoreCause);

const updateStoppedVm = (
  limaHome: string,
  name: string,
  currentPorts: readonly PortMapping[],
  nextPorts: readonly PortMapping[]
) =>
  Effect.gen(function* updateStoppedVmHandler() {
    yield* editVmNetwork(
      name,
      nextPorts,
      `Failed to update port mappings for ${name}`,
      `Updating port mappings for ${name}…`
    );
    yield* writeVmNetwork(limaHome, name, nextPorts);
  }).pipe(
    Effect.onError(() =>
      editVmNetwork(
        name,
        currentPorts,
        `Failed to restore port mappings for ${name}`,
        `Restoring port mappings for ${name}…`
      ).pipe(Effect.ignoreCause)
    )
  );

const updateRunningVm = (
  limaHome: string,
  name: string,
  currentPorts: readonly PortMapping[],
  nextPorts: readonly PortMapping[]
) =>
  Effect.gen(function* updateRunningVmHandler() {
    const expiresAt = yield* readVmTtl(limaHome, name);

    yield* Effect.gen(function* restartWithUpdatedNetworkHandler() {
      yield* stopVm(name);
      yield* editVmNetwork(
        name,
        nextPorts,
        `Failed to update port mappings for ${name}`,
        `Updating port mappings for ${name}…`
      );
      yield* startVm(name);
      yield* restoreTtl(limaHome, name, expiresAt);
      yield* writeVmNetwork(limaHome, name, nextPorts);
    }).pipe(
      Effect.onError(() =>
        restoreRunningVm(limaHome, name, currentPorts, expiresAt)
      )
    );
  });

const updateVmNetwork = (
  name: string,
  update: (
    ports: readonly PortMapping[]
  ) => Effect.Effect<
    readonly PortMapping[],
    PortAlreadyPublishedError | PortNotPublishedError
  >
) =>
  Effect.gen(function* updateVmNetworkHandler() {
    const userConfig = yield* UserConfig;
    return yield* withVmLock(
      userConfig.configPath,
      name,
      Effect.gen(function* updateLockedVmNetworkHandler() {
        const fs = yield* FileSystem.FileSystem;
        const lima = yield* LimaRuntime;
        const exists = yield* fs.exists(path.join(userConfig.lima.home, name));

        if (!exists) {
          return yield* new VmNotFoundError({ name });
        }

        yield* lima.assertIsolated(name);
        const currentPorts = yield* readVmNetwork(userConfig.lima.home, name);
        const nextPorts = yield* update(currentPorts);
        const { stdout } = yield* lima.capture([
          "list",
          name,
          "--format={{.Status}}",
        ]);
        const status = stdout.trim();

        if (status === "Running") {
          yield* updateRunningVm(
            userConfig.lima.home,
            name,
            currentPorts,
            nextPorts
          );
        } else if (status === "Stopped") {
          yield* updateStoppedVm(
            userConfig.lima.home,
            name,
            currentPorts,
            nextPorts
          );
        } else {
          return yield* new VmLifecycleStateError({ name, status });
        }

        return nextPorts;
      })
    );
  });

const add = Command.make(
  "add",
  {
    name: vmName,
    portMapping: Argument.string("mapping").pipe(
      Argument.withSchema(PortMappingArgument),
      Argument.withDescription("Port mapping in HOST_PORT:GUEST_PORT format")
    ),
  },
  ({ name, portMapping }) =>
    Effect.gen(function* addPortHandler() {
      const startedAt = yield* Clock.currentTimeMillis;
      yield* updateVmNetwork(name, (ports) => {
        const duplicate = ports.some(
          ({ hostPort }) => hostPort === portMapping.hostPort
        );
        return duplicate
          ? Effect.fail(
              new PortAlreadyPublishedError({
                hostPort: portMapping.hostPort,
                name,
              })
            )
          : Effect.succeed([...ports, portMapping]);
      });
      const elapsedSeconds = Math.max(
        0,
        Math.round(((yield* Clock.currentTimeMillis) - startedAt) / 1000)
      );
      yield* Console.log(
        `✔ Published 127.0.0.1:${portMapping.hostPort} → ${name}:${portMapping.guestPort} in ${elapsedSeconds}s`
      );
    })
).pipe(
  Command.withDescription("Publish a VM port on parent localhost"),
  Command.withExamples([
    {
      command: "weave port add dev 8080:3000",
      description: "Forward parent localhost port 8080 to guest TCP port 3000",
    },
  ])
);

const remove = Command.make(
  "remove",
  {
    name: vmName,
    port: Argument.integer("host-port").pipe(
      Argument.withSchema(PortNumber),
      Argument.withDescription("Published parent port to remove")
    ),
  },
  ({ name, port }) =>
    Effect.gen(function* removePortHandler() {
      const startedAt = yield* Clock.currentTimeMillis;
      yield* updateVmNetwork(name, (ports) => {
        const nextPorts = ports.filter((mapping) => mapping.hostPort !== port);
        return nextPorts.length === ports.length
          ? Effect.fail(new PortNotPublishedError({ hostPort: port, name }))
          : Effect.succeed(nextPorts);
      });
      const elapsedSeconds = Math.max(
        0,
        Math.round(((yield* Clock.currentTimeMillis) - startedAt) / 1000)
      );
      yield* Console.log(
        `✔ Removed published port 127.0.0.1:${port} from ${name} in ${elapsedSeconds}s`
      );
    })
).pipe(
  Command.withAlias("rm"),
  Command.withDescription("Remove a published VM port"),
  Command.withExamples([
    {
      command: "weave port remove dev 8080",
    },
  ])
);

const list = Command.make("ls", { name: vmName }, ({ name }) =>
  Effect.gen(function* listPortsHandler() {
    const fs = yield* FileSystem.FileSystem;
    const userConfig = yield* UserConfig;
    const exists = yield* fs.exists(path.join(userConfig.lima.home, name));

    if (!exists) {
      return yield* new VmNotFoundError({ name });
    }

    const ports = yield* readVmNetwork(userConfig.lima.home, name);
    const rows = ports.map(
      ({ guestPort, hostPort }) => `127.0.0.1:${hostPort}\t${guestPort}\ttcp`
    );
    yield* Console.log(["PARENT\tGUEST\tPROTOCOL", ...rows].join("\n"));
  })
).pipe(
  Command.withAlias("list"),
  Command.withDescription("List published VM ports"),
  Command.withExamples([
    {
      command: "weave port ls dev",
    },
  ])
);

export const port = Command.make("port").pipe(
  Command.withDescription("Manage parent-to-VM port mappings"),
  Command.withSubcommands([add, remove, list])
);
