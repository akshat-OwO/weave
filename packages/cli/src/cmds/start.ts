import path from "node:path";

import { Clock, Console, Effect, FileSystem, Schema } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import {
  limaMountArguments,
  mount,
  mountPaths,
  validateMountDirectories,
} from "../lib/vm-mounts";
import { scheduleVmTtl } from "../lib/vm-ttl";
import { InvalidMountArgumentsError } from "../schemas/errors/invalid-mount-arguments.schema";
import { VmAlreadyRunningError } from "../schemas/errors/vm-already-running.schema";
import { VmLifecycleStateError } from "../schemas/errors/vm-lifecycle-state.schema";
import { VmNotFoundError } from "../schemas/errors/vm-not-found.schema";
import { Ttl } from "../schemas/ttl.schema";
import { VmName } from "../schemas/vm-name.schema";
import { LimaRuntime } from "../services/lima-runtime";
import { UserConfig } from "../services/user-config";

const ttl = Flag.string("ttl").pipe(
  Flag.withSchema(Ttl),
  Flag.withDefault(Schema.decodeUnknownSync(Ttl)("10m")),
  Flag.withMetavar("DURATION"),
  Flag.withDescription(
    "Time to live: <number>s, <number>m, <number>h, or <number>d"
  )
);

export const start = Command.make(
  "start",
  {
    mount,
    name: Argument.string("name").pipe(
      Argument.withSchema(VmName),
      Argument.withDescription("Name of the stopped VM to start")
    ),
    paths: mountPaths,
    ttl,
  },
  ({ mount: mountFlags, name, paths: remainingMountPaths, ttl: vmTtl }) =>
    Effect.gen(function* startHandler() {
      const startedAt = yield* Clock.currentTimeMillis;
      const fs = yield* FileSystem.FileSystem;
      const lima = yield* LimaRuntime;
      const processSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const userConfig = yield* UserConfig;
      const exists = yield* fs.exists(path.join(userConfig.lima.home, name));

      const mountEnabled = mountFlags[0] === true;
      if (mountEnabled === (remainingMountPaths.length === 0)) {
        return yield* new InvalidMountArgumentsError({
          mountEnabled,
          paths: remainingMountPaths,
        });
      }

      if (!exists) {
        return yield* new VmNotFoundError({ name });
      }

      yield* lima.assertIsolated(name);
      const statusCommand = ChildProcess.make(
        userConfig.lima.executable,
        ["list", name, "--format={{.Status}}"],
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
        Effect.flatMap(Schema.decodeUnknownEffect(Schema.String))
      );

      if (status === "Running") {
        return yield* new VmAlreadyRunningError({ name });
      }

      if (status !== "Stopped") {
        return yield* new VmLifecycleStateError({ name, status });
      }

      yield* lima.run(
        [
          "start",
          "--tty=false",
          "--progress",
          ...limaMountArguments(
            yield* validateMountDirectories(remainingMountPaths)
          ),
          name,
        ],
        {
          progress: {
            failureMessage: `Failed to start ${name}`,
            initialMessage: `Starting ${name}…`,
          },
        }
      );
      yield* scheduleVmTtl(userConfig.lima.home, name, vmTtl);

      const finishedAt = yield* Clock.currentTimeMillis;
      const elapsedSeconds = Math.max(
        0,
        Math.round((finishedAt - startedAt) / 1000)
      );
      yield* Console.log(
        `✔ Started ${name} in ${elapsedSeconds}s (TTL: ${vmTtl.value})`
      );
    })
).pipe(
  Command.withDescription("Start a stopped VM with selected host mounts"),
  Command.withExamples([
    {
      command: "weave start dev",
      description: "Start a stopped VM with a new 10m TTL",
    },
    {
      command: "weave start dev --ttl 1h",
      description: "Start a stopped VM with a custom TTL",
    },
    {
      command: "weave start dev --mount ./src ./config",
      description: "Start a stopped VM with selected host directories mounted",
    },
  ])
);
