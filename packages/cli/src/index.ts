import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Effect, Layer } from "effect";
import { Command } from "effect/unstable/cli";

import { weave } from "./cmds";
import { LimaRuntimeLive } from "./services/lima-runtime";
import { UserConfig, UserConfigLive } from "./services/user-config";

const DependenciesLive = Layer.merge(BunServices.layer, UserConfigLive);

const AppLive = LimaRuntimeLive.pipe(Layer.provideMerge(DependenciesLive));

const program = Effect.gen(function* programHandler() {
  const userConfig = yield* UserConfig;

  yield* userConfig.init();

  yield* Command.run(weave, { version: "0.0.0" });
});

program.pipe(Effect.provide(AppLive), BunRuntime.runMain);
