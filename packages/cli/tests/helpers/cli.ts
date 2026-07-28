import * as BunCrypto from "@effect/platform-bun/BunCrypto";
import * as BunPath from "@effect/platform-bun/BunPath";
import type { Cause } from "effect";
import {
  Effect,
  FileSystem,
  Layer,
  Option,
  PlatformError,
  Queue,
  Stdio,
  Stream,
  Terminal,
} from "effect";
import { TestConsole } from "effect/testing";
import { Command } from "effect/unstable/cli";
import { ChildProcessSpawner } from "effect/unstable/process";
import type { ChildProcess } from "effect/unstable/process";

import cliPackage from "../../package.json" with { type: "json" };
import { weave } from "../../src/cmds";
import { vmTtlMetadataPath } from "../../src/lib/vm-ttl";
import type { CliLifecycleError } from "../../src/schemas/errors/cli-lifecycle.schema";
import { CliLifecycle } from "../../src/services/cli-lifecycle";
import type { UpgradeResult } from "../../src/services/cli-lifecycle";
import { LimaRuntime } from "../../src/services/lima-runtime";
import { UserConfig } from "../../src/services/user-config";

export interface LimaCall {
  readonly args: readonly string[];
  readonly acceptableExitCodes?: readonly number[];
  readonly captured?: boolean;
  readonly progress?: {
    readonly failureMessage: string;
    readonly initialMessage: string;
  };
}

export interface CliHarness {
  readonly calls: LimaCall[];
  readonly fileWrites: readonly {
    readonly contents: string;
    readonly path: string;
  }[];
  readonly lifecycleCalls: readonly string[];
  readonly processCalls: ChildProcess.Command[];
  readonly stderr: string[];
  readonly stdout: string[];
  readonly run: (
    args: readonly string[]
  ) => Effect.Effect<void, unknown, never>;
}

interface CliHarnessOptions {
  readonly confirmStart?: boolean;
  readonly existingVm?: boolean;
  readonly fileContents?: Readonly<Record<string, string>>;
  readonly lifecycle?: {
    readonly uninstallError?: CliLifecycleError;
    readonly uninstallResult?: {
      readonly deferred: boolean;
      readonly path: string;
      readonly recoveryLog?: string;
    };
    readonly upgradeError?: CliLifecycleError;
    readonly upgradeResult?: UpgradeResult;
  };
  readonly limaRunFailures?: readonly string[];
  readonly limaOutputs?: readonly {
    readonly stderr: string;
    readonly stdout: string;
  }[];
  readonly managedState?: boolean;
  readonly mountPathTypes?: Readonly<
    Record<string, FileSystem.File.Type | undefined>
  >;
  readonly processOutputs?: readonly string[];
  readonly ttlExpiresAtByVm?: Readonly<Record<string, number>>;
}

const configPath = "/test/weave";
const limaHome = `${configPath}/lima-home`;

export const makeCliHarness = (options: CliHarnessOptions = {}): CliHarness => {
  const calls: LimaCall[] = [];
  const directories = new Set<string>();
  const fileWrites: {
    readonly contents: string;
    readonly path: string;
  }[] = [];
  const limaOutputs = [...(options.limaOutputs ?? [])];
  const lifecycleCalls: string[] = [];
  const storedFiles = new Map(Object.entries(options.fileContents ?? {}));
  let temporaryFileIndex = 0;
  const processCalls: ChildProcess.Command[] = [];
  const processOutputs = [...(options.processOutputs ?? [])];
  const stderr: string[] = [];
  const stdout: string[] = [];
  const vmNames = new Set(options.existingVm === true ? ["dev"] : []);
  const terminalLayer = Layer.effect(
    Terminal.Terminal,
    Effect.gen(function* testTerminalHandler() {
      const input = yield* Queue.make<Terminal.UserInput, Cause.Done>();
      const confirmed = options.confirmStart !== false;
      Queue.offerUnsafe(input, {
        input: confirmed ? Option.none() : Option.some("n"),
        key: {
          ctrl: false,
          meta: false,
          name: confirmed ? "enter" : "n",
          shift: false,
        },
      });

      return Terminal.make({
        columns: Effect.succeed(80),
        display: () => Effect.void,
        readInput: Effect.succeed(input),
        readLine: Effect.die("Unexpected terminal readLine call"),
        rows: Effect.succeed(24),
      });
    })
  );

  const lima = LimaRuntime.of({
    assertIsolated: () => Effect.void,
    capture: (args) =>
      Effect.sync(() => {
        calls.push({ args, captured: true });
        return limaOutputs.shift() ?? { stderr: "", stdout: "" };
      }),
    run: (args, runOptions) =>
      Effect.gen(function* limaRunHandler() {
        calls.push({
          acceptableExitCodes: runOptions?.acceptableExitCodes,
          args,
          progress: runOptions?.progress,
        });
        const name = args.at(-1);
        if (
          name !== undefined &&
          options.limaRunFailures?.includes(name) === true
        ) {
          return yield* Effect.die(`simulated failure for ${name}`);
        }

        if (args[0] === "start") {
          const createdName = args
            .find((argument) => argument.startsWith("--name="))
            ?.slice("--name=".length);
          if (createdName !== undefined) {
            vmNames.add(createdName);
          }
        } else if (args[0] === "clone") {
          const clonedName = args.at(-1);
          if (clonedName !== undefined) {
            vmNames.add(clonedName);
          }
        } else if (args[0] === "delete") {
          const deletedName = args.at(-1);
          if (deletedName !== undefined) {
            vmNames.delete(deletedName);
          }
        }
      }),
  });
  const lifecycle = CliLifecycle.of({
    uninstall: Effect.gen(function* uninstallHandler() {
      lifecycleCalls.push("uninstall");
      if (options.lifecycle?.uninstallError !== undefined) {
        return yield* options.lifecycle.uninstallError;
      }
      return (
        options.lifecycle?.uninstallResult ?? {
          deferred: false,
          path: "/usr/local/bin/weave",
        }
      );
    }),
    upgrade: (installedVersion) =>
      Effect.gen(function* upgradeHandler() {
        lifecycleCalls.push(`upgrade:${installedVersion}`);
        if (options.lifecycle?.upgradeError !== undefined) {
          return yield* options.lifecycle.upgradeError;
        }
        return (
          options.lifecycle?.upgradeResult ?? {
            _tag: "Current",
            installedVersion,
          }
        );
      }),
  });
  const userConfig = UserConfig.of({
    configPath,
    init: () => Effect.void,
    lima: {
      executable: "/test/bin/limactl",
      home: limaHome,
      runtime: "/test/runtime/lima",
    },
  });
  const fileSystem = FileSystem.makeNoop({
    exists: (path) => {
      if (Object.hasOwn(options.mountPathTypes ?? {}, path)) {
        return Effect.succeed(options.mountPathTypes?.[path] !== undefined);
      }

      if (options.managedState === true && path === limaHome) {
        return Effect.succeed(true);
      }

      if ([...vmNames].some((name) => path === `${limaHome}/${name}`)) {
        return Effect.succeed(true);
      }

      if (storedFiles.has(path)) {
        return Effect.succeed(true);
      }

      return Effect.succeed(
        Object.entries(options.ttlExpiresAtByVm ?? {}).some(
          ([name]) => path === vmTtlMetadataPath(limaHome, name)
        )
      );
    },
    makeDirectory: (path, makeOptions) =>
      Effect.suspend(() => {
        if (directories.has(path) && makeOptions?.recursive !== true) {
          return Effect.fail(
            PlatformError.systemError({
              _tag: "AlreadyExists",
              method: "makeDirectory",
              module: "FileSystem",
              pathOrDescriptor: path,
            })
          );
        }
        directories.add(path);
        return Effect.void;
      }),
    makeTempFile: (makeOptions) =>
      Effect.sync(() => {
        temporaryFileIndex += 1;
        const temporaryPath = `${makeOptions?.directory ?? "/tmp"}/${makeOptions?.prefix ?? ""}${temporaryFileIndex}${makeOptions?.suffix ?? ""}`;
        storedFiles.set(temporaryPath, "");
        return temporaryPath;
      }),
    readDirectory: (directory) =>
      Effect.sync(() => {
        const prefix = `${directory}/`;
        return [...storedFiles.keys()].flatMap((filePath) => {
          if (!filePath.startsWith(prefix)) {
            return [];
          }
          const entry = filePath.slice(prefix.length);
          return entry.includes("/") ? [] : [entry];
        });
      }),
    readFileString: (path) => {
      const contents = storedFiles.get(path);
      if (contents !== undefined) {
        return Effect.succeed(contents);
      }

      const entry = Object.entries(options.ttlExpiresAtByVm ?? {}).find(
        ([name]) => path === vmTtlMetadataPath(limaHome, name)
      );

      return Effect.succeed(
        JSON.stringify({
          expiresAt: entry?.[1],
        })
      );
    },
    remove: (path, removeOptions) =>
      Effect.sync(() => {
        storedFiles.delete(path);
        directories.delete(path);
        if (removeOptions?.recursive === true) {
          const prefix = `${path}/`;
          for (const storedPath of storedFiles.keys()) {
            if (storedPath.startsWith(prefix)) {
              storedFiles.delete(storedPath);
            }
          }
          for (const directory of directories) {
            if (directory.startsWith(prefix)) {
              directories.delete(directory);
            }
          }
        }
      }),
    rename: (oldPath, newPath) =>
      Effect.sync(() => {
        const contents = storedFiles.get(oldPath);
        if (contents === undefined) {
          throw new Error(`Unexpected rename source ${oldPath}`);
        }
        storedFiles.delete(oldPath);
        storedFiles.set(newPath, contents);
      }),
    stat: (path) => {
      const type = options.mountPathTypes?.[path];
      return type === undefined
        ? Effect.die(`Unexpected stat call for ${path}`)
        : Effect.succeed({ type } as FileSystem.File.Info);
    },
    writeFileString: (path, contents) =>
      Effect.sync(() => {
        storedFiles.set(path, contents);
        fileWrites.push({ contents, path });
      }),
  });
  const processSpawner = ChildProcessSpawner.ChildProcessSpawner.of({
    exitCode: () => Effect.die("Unexpected process exitCode call"),
    lines: () => Effect.die("Unexpected process lines call"),
    spawn: () => Effect.die("Unexpected process spawn call"),
    streamLines: () => Stream.die("Unexpected process streamLines call"),
    streamString: () => Stream.die("Unexpected process streamString call"),
    string: (command) =>
      Effect.sync(() => {
        processCalls.push(command);
        return processOutputs.shift() ?? "";
      }),
  });

  const run = (args: readonly string[]) =>
    Effect.gen(function* runHandler() {
      const initialLogCount = (yield* TestConsole.logLines).length;
      const initialErrorCount = (yield* TestConsole.errorLines).length;
      const captureOutput = Effect.gen(function* captureOutputHandler() {
        const logs = yield* TestConsole.logLines;
        const errors = yield* TestConsole.errorLines;

        stdout.push(...logs.slice(initialLogCount).map(String));
        stderr.push(...errors.slice(initialErrorCount).map(String));
      });

      return yield* Command.runWith(weave, {
        version: cliPackage.version,
      })(args).pipe(
        Effect.provideService(LimaRuntime, lima),
        Effect.provideService(CliLifecycle, lifecycle),
        Effect.provideService(UserConfig, userConfig),
        Effect.provideService(FileSystem.FileSystem, fileSystem),
        Effect.provideService(
          ChildProcessSpawner.ChildProcessSpawner,
          processSpawner
        ),
        Effect.provide(
          Layer.mergeAll(
            BunCrypto.layer,
            BunPath.layer,
            terminalLayer,
            Stdio.layerTest({})
          )
        ),
        Effect.mapError((error) => error as unknown),
        Effect.ensuring(captureOutput)
      );
    });

  return {
    calls,
    fileWrites,
    lifecycleCalls,
    processCalls,
    run,
    stderr,
    stdout,
  };
};
