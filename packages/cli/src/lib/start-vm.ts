import { Effect } from "effect";

import { LimaRuntime } from "../services/lima-runtime";
import { limaNetworkArguments, readVmNetwork } from "./vm-network";

export const startVmWithNetwork = Effect.fn(
  "weave/lib/startVm/startVmWithNetwork"
)(function* startVmWithNetworkHandler(
  limaHome: string,
  name: string,
  startArguments: readonly string[] = []
) {
  const lima = yield* LimaRuntime;
  yield* lima.run(
    [
      "edit",
      "--tty=false",
      ...limaNetworkArguments(yield* readVmNetwork(limaHome, name)),
      name,
    ],
    {
      progress: {
        failureMessage: `Failed to update port restrictions for ${name}`,
        initialMessage: `Updating port restrictions for ${name}…`,
      },
    }
  );
  yield* lima.run(
    ["start", "--tty=false", "--progress", ...startArguments, name],
    {
      progress: {
        failureMessage: `Failed to start ${name}`,
        initialMessage: `Starting ${name}…`,
      },
    }
  );
});
