import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Effect, Layer } from "effect";
import { Command } from "effect/unstable/cli";

import cliPackage from "../package.json" with { type: "json" };
import { weave } from "./cmds";
import {
  CliLifecycleLive,
  CliLifecyclePlatformLive,
} from "./services/cli-lifecycle";
import { LimaRuntimeLive } from "./services/lima-runtime";
import { UserConfigLive } from "./services/user-config";

const DependenciesLive = Layer.merge(BunServices.layer, UserConfigLive);

const InfrastructureLive = Layer.merge(
  LimaRuntimeLive,
  CliLifecyclePlatformLive
).pipe(Layer.provideMerge(DependenciesLive));

const AppLive = CliLifecycleLive.pipe(Layer.provideMerge(InfrastructureLive));

const program = Effect.gen(function* programHandler() {
  yield* Command.run(weave, { version: cliPackage.version });
});

program.pipe(Effect.provide(AppLive), BunRuntime.runMain);
