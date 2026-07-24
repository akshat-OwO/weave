import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Console, Effect, Layer } from "effect";
import { Command } from "effect/unstable/cli";

import { UserConfig, UserConfigLive } from "./services/user-config";

const weave = Command.make("weave", {}, () => Console.log("hello world"));

const AppLive = Layer.merge(BunServices.layer, UserConfigLive);

const program = Effect.gen(function* programHandler() {
  const userConfig = yield* UserConfig;

  yield* userConfig.init();

  yield* Command.run(weave, { version: "0.0.0" });
});

program.pipe(Effect.provide(AppLive), BunRuntime.runMain);
