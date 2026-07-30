import { Effect } from "effect";
import { Prompt } from "effect/unstable/cli";

import { LimaRuntime } from "../services/lima-runtime";
import { UserConfig } from "../services/user-config";
import { startVmWithNetwork } from "./start-vm";
import { withVmLock } from "./vm-lock";

const readVmStatus = (name: string) =>
  LimaRuntime.use((lima) =>
    lima
      .capture(["list", name, "--format={{.Status}}"])
      .pipe(Effect.map(({ stdout }) => stdout.trim()))
  );

export const ensureVmRunning = Effect.fn("weave/lib/ensureVmRunning")(
  function* ensureVmRunningHandler(name: string) {
    if ((yield* readVmStatus(name)) !== "Stopped") {
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

    const userConfig = yield* UserConfig;
    return yield* withVmLock(
      userConfig.configPath,
      name,
      Effect.gen(function* startStoppedVmHandler() {
        if ((yield* readVmStatus(name)) === "Stopped") {
          yield* startVmWithNetwork(userConfig.lima.home, name);
        }
        return true;
      })
    );
  }
);
