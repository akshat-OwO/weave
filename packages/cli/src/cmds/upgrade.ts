import { Console, Effect } from "effect";
import { Command } from "effect/unstable/cli";

import cliPackage from "../../package.json" with { type: "json" };
import type { CliLifecycleError } from "../schemas/errors/cli-lifecycle.schema";
import { CliLifecycle } from "../services/cli-lifecycle";

const reportUpgradeError = (error: CliLifecycleError) =>
  Effect.gen(function* reportUpgradeErrorHandler() {
    yield* Console.error(
      `✖ Upgrade failed during ${error.phase}: ${error.detail}`
    );
    yield* Console.error(`Recovery: ${error.recovery}`);
    return yield* error;
  });

export const upgrade = Command.make("upgrade", {}, () =>
  Effect.gen(function* upgradeHandler() {
    const lifecycle = yield* CliLifecycle;
    yield* Console.log(
      `Checking for a compatible update (installed ${cliPackage.version})…`
    );
    const result = yield* lifecycle.upgrade(cliPackage.version);

    switch (result._tag) {
      case "Current": {
        yield* Console.log(
          `✔ Weave ${result.installedVersion} is already up to date`
        );
        break;
      }
      case "Ahead": {
        yield* Console.log(
          `✔ Weave ${result.installedVersion} is newer than the latest compatible release (${result.latestVersion}); no changes made`
        );
        break;
      }
      case "Upgraded": {
        if (result.deferred) {
          yield* Console.log(
            `✔ Scheduled Weave ${result.fromVersion} → ${result.toVersion}`
          );
          yield* Console.log(
            `Windows will replace ${result.path} atomically after this process exits`
          );
          if (result.recoveryLog !== undefined) {
            yield* Console.log(
              `Any deferred replacement failure will be recorded in ${result.recoveryLog}`
            );
          }
        } else {
          yield* Console.log(
            `✔ Upgraded Weave ${result.fromVersion} → ${result.toVersion}`
          );
          yield* Console.log(`Installed atomically at ${result.path}`);
        }
        break;
      }
      default: {
        break;
      }
    }
  }).pipe(Effect.catch(reportUpgradeError))
).pipe(
  Command.withDescription(
    "Upgrade the installed CLI to the latest stable release"
  ),
  Command.withExamples([{ command: "weave upgrade" }])
);
