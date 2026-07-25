import { Effect } from "effect";
import { Command } from "effect/unstable/cli";

import { LimaRuntime } from "../services/lima-runtime";

export const list = Command.make("ls", {}, () =>
  Effect.gen(function* listHandler() {
    const lima = yield* LimaRuntime;
    yield* lima.run(["list"]);
  })
).pipe(
  Command.withAlias("list"),
  Command.withDescription("List running and stopped Lima VMs"),
  Command.withExamples([{ command: "weave ls" }])
);
