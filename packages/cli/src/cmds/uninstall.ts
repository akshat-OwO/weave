import { Cause, Console, Effect, Exit, FileSystem } from "effect";
import { Command } from "effect/unstable/cli";

import { CliLifecycleError } from "../schemas/errors/cli-lifecycle.schema";
import { CliLifecycle } from "../services/cli-lifecycle";
import { LimaRuntime } from "../services/lima-runtime";
import { UserConfig } from "../services/user-config";
import { runningVmNamesFromList } from "./list";

const retainedDataMessage = (configPath: string) =>
  `Retained runtime, configuration, VM disks, and user data in ${configPath}`;

const reportLifecycleError = (error: CliLifecycleError) =>
  Effect.gen(function* reportLifecycleErrorHandler() {
    yield* Console.error(
      `✖ Uninstall failed during ${error.phase}: ${error.detail}`
    );
    yield* Console.error(`Recovery: ${error.recovery}`);
    return yield* error;
  });

const stopRunningVms = Effect.gen(function* stopRunningVmsHandler() {
  const fs = yield* FileSystem.FileSystem;
  const lima = yield* LimaRuntime;
  const userConfig = yield* UserConfig;
  const hasManagedState = yield* fs.exists(userConfig.lima.home).pipe(
    Effect.mapError(
      (error) =>
        new CliLifecycleError({
          detail: `Could not inspect managed VM state: ${error.message}`,
          phase: "removal",
          recovery:
            "The CLI was not removed. Verify access to the Weave data directory and retry `weave uninstall`.",
        })
    )
  );

  if (!hasManagedState) {
    yield* Console.log("No Weave-managed VM state found");
    return;
  }

  const discovery = yield* Effect.exit(lima.capture(["list"]));
  if (Exit.isFailure(discovery)) {
    return yield* new CliLifecycleError({
      detail: `Could not discover managed VMs: ${Cause.pretty(discovery.cause).split("\n")[0]}`,
      phase: "removal",
      recovery:
        "The CLI was not removed. Restore Lima availability, stop all Weave VMs, and retry `weave uninstall`.",
    });
  }

  const runningVms = runningVmNamesFromList(discovery.value.stdout);
  if (runningVms.length === 0) {
    yield* Console.log("No running Weave-managed VMs found");
    return;
  }

  yield* Console.log(
    `Stopping ${runningVms.length} running Weave-managed VM${runningVms.length === 1 ? "" : "s"}…`
  );
  const failures: string[] = [];

  for (const name of runningVms) {
    const stopped = yield* Effect.exit(
      lima.run(["stop", "--tty=false", name], {
        progress: {
          failureMessage: `Failed to stop ${name}`,
          initialMessage: `Stopping ${name}…`,
        },
      })
    );

    if (Exit.isSuccess(stopped)) {
      yield* Console.log(`✔ Stopped ${name}`);
    } else {
      failures.push(name);
      yield* Console.error(
        `✖ Failed to stop ${name}: ${Cause.pretty(stopped.cause).split("\n")[0]}`
      );
    }
  }

  if (failures.length > 0) {
    return yield* new CliLifecycleError({
      detail: `Could not stop ${failures.join(", ")}`,
      phase: "removal",
      recovery:
        "The CLI was not removed. Resolve the VM shutdown errors and rerun `weave uninstall`.",
    });
  }
});

export const uninstall = Command.make("uninstall", {}, () =>
  Effect.gen(function* uninstallHandler() {
    const lifecycle = yield* CliLifecycle;
    const userConfig = yield* UserConfig;

    yield* Console.log("Preparing to uninstall Weave…");
    yield* stopRunningVms;
    const removal = yield* lifecycle.uninstall;
    if (removal.deferred) {
      yield* Console.log(
        `✔ Scheduled removal of Weave CLI from ${removal.path}`
      );
      yield* Console.log(
        "Windows will remove the executable after this process exits"
      );
      if (removal.recoveryLog !== undefined) {
        yield* Console.log(
          `Any deferred removal failure will be recorded in ${removal.recoveryLog}`
        );
      }
    } else {
      yield* Console.log(`✔ Removed Weave CLI from ${removal.path}`);
    }
    yield* Console.log(retainedDataMessage(userConfig.configPath));
    yield* Console.log(
      "No persistent data was deleted. Remove that directory manually only if you no longer need any Weave VMs or data."
    );
  }).pipe(Effect.catch(reportLifecycleError))
).pipe(
  Command.withDescription(
    "Stop managed VMs and remove the CLI while retaining all persistent data"
  ),
  Command.withExamples([{ command: "weave uninstall" }])
);
