import { Effect } from "effect";
import { Prompt } from "effect/unstable/cli";

import { LimaRuntime } from "../services/lima-runtime";

export const ensureVmRunning = Effect.fn("weave/lib/ensureVmRunning")(
  function* ensureVmRunningHandler(name: string) {
    const lima = yield* LimaRuntime;
    const status = yield* lima.capture(["list", name, "--format={{.Status}}"]);

    if (status.stdout.trim() !== "Stopped") {
      return true;
    }

    const shouldStart = yield* Prompt.run(
      Prompt.confirm({
        initial: true,
        label: {
          confirm: "Yes",
          deny: "No",
        },
        message: "Do you want to start the instance now?",
      })
    );

    if (!shouldStart) {
      return false;
    }

    yield* lima.run(["start", "--tty=false", "--progress", name], {
      progress: {
        failureMessage: `Failed to start ${name}`,
        initialMessage: `Starting ${name}…`,
      },
    });

    return true;
  }
);
