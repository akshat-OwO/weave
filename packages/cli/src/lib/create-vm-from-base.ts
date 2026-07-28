import { Clock, Effect, Exit, Option } from "effect";

import { LimaRuntime } from "../services/lima-runtime";
import {
  freshVmBase,
  makeVmBaseName,
  readVmBaseMetadata,
  withVmBaseLock,
  writeVmBaseMetadata,
} from "./vm-base-cache";

interface CreateVmFromBaseOptions {
  readonly cacheKey: string;
  readonly configPath: string;
  readonly cpuCount: number;
  readonly limaHome: string;
  readonly memorySize: number;
  readonly mountArguments: readonly string[];
  readonly templateArguments: readonly string[];
  readonly vmArguments: readonly string[];
  readonly vmName: string;
}

interface PrepareVmBaseOptions {
  readonly cacheKey: string;
  readonly configPath: string;
  readonly cpuCount: number;
  readonly limaHome: string;
  readonly templateArguments: readonly string[];
  readonly vmArguments: readonly string[];
}

const deleteVm = (name: string) =>
  Effect.gen(function* deleteVmHandler() {
    const lima = yield* LimaRuntime;
    yield* lima.run(["delete", "--force", "--tty=false", name], {
      progress: {
        failureMessage: `Failed to clean up ${name}`,
        initialMessage: `Cleaning up ${name}…`,
      },
    });
  });

const ignoreDeleteVm = (name: string) =>
  deleteVm(name).pipe(Effect.ignoreCause);

const tryDeleteVm = (name: string) =>
  deleteVm(name).pipe(Effect.exit, Effect.map(Exit.isSuccess));

const prepareVmBase = Effect.fn("weave/lib/prepareVmBase")(
  function* prepareVmBaseHandler(options: PrepareVmBaseOptions) {
    const cachedBase = yield* freshVmBase(
      options.configPath,
      options.limaHome,
      options.cacheKey
    );

    if (Option.isSome(cachedBase)) {
      return cachedBase.value;
    }

    const lima = yield* LimaRuntime;
    const previousMetadata = yield* readVmBaseMetadata(
      options.configPath,
      options.cacheKey
    );
    const builtAt = yield* Clock.currentTimeMillis;
    const baseName = makeVmBaseName(options.cacheKey, builtAt);
    const retiredNames = Option.match(previousMetadata, {
      onNone: () => [],
      onSome: (metadata) => [metadata.name, ...(metadata.retiredNames ?? [])],
    }).filter((name) => name !== baseName);
    const metadata = {
      builtAt,
      cacheKey: options.cacheKey,
      name: baseName,
      retiredNames,
    };
    const buildBase = Effect.gen(function* buildBaseHandler() {
      yield* lima.run(
        [
          "start",
          "--tty=false",
          "--progress",
          `--name=${baseName}`,
          `--cpus=${options.cpuCount}`,
          "--memory=2",
          "--mount-none",
          ...options.vmArguments,
          ...options.templateArguments,
        ],
        {
          progress: {
            failureMessage: "Failed to prepare cached environment",
            initialMessage: "Preparing cached environment…",
          },
        }
      );
      yield* lima.run(["stop", "--tty=false", baseName], {
        progress: {
          failureMessage: "Failed to finalize cached environment",
          initialMessage: "Finalizing cached environment…",
        },
      });
      yield* writeVmBaseMetadata(options.configPath, metadata);
    }).pipe(Effect.onError(() => ignoreDeleteVm(baseName)));

    yield* buildBase;

    const failedRetiredNames: string[] = [];
    for (const retiredName of retiredNames) {
      if (!(yield* tryDeleteVm(retiredName))) {
        failedRetiredNames.push(retiredName);
      }
    }
    if (failedRetiredNames.length !== retiredNames.length) {
      yield* writeVmBaseMetadata(options.configPath, {
        ...metadata,
        retiredNames: failedRetiredNames,
      }).pipe(Effect.ignoreCause);
    }

    return baseName;
  }
);

export const createVmFromBase = Effect.fn("weave/lib/createVmFromBase")(
  function* createVmFromBaseHandler(options: CreateVmFromBaseOptions) {
    const lima = yield* LimaRuntime;
    const cloneAndStart = Effect.gen(function* cloneAndStartHandler() {
      yield* withVmBaseLock(
        options.configPath,
        options.cacheKey,
        Effect.gen(function* cloneFromLockedBaseHandler() {
          const baseName = yield* prepareVmBase(options);
          yield* lima.run(
            [
              "clone",
              "--tty=false",
              `--cpus=${options.cpuCount}`,
              `--memory=${options.memorySize}`,
              ...options.mountArguments,
              baseName,
              options.vmName,
            ],
            {
              progress: {
                failureMessage: "Failed to clone cached environment",
                initialMessage: "Cloning cached environment…",
              },
            }
          );
        })
      );
      yield* lima.run(["start", "--tty=false", "--progress", options.vmName], {
        progress: {
          failureMessage: "Failed to start virtual machine",
          initialMessage: "Starting virtual machine…",
        },
      });
    }).pipe(Effect.onError(() => ignoreDeleteVm(options.vmName)));

    yield* cloneAndStart;
  }
);
