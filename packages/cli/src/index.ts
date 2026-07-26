import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Effect, Layer } from "effect";
import { Command } from "effect/unstable/cli";

import { weave } from "./cmds";
import { FirecrackerArtifactsLive } from "./services/firecracker-artifacts";
import { FirecrackerHostLive } from "./services/firecracker-host";
import { LimaRuntimeLive } from "./services/lima-runtime";
import { UserConfigLive } from "./services/user-config";
import { VmManagerLive } from "./services/vm-manager";
import { VmStateLive } from "./services/vm-state";

const DependenciesLive = Layer.merge(BunServices.layer, UserConfigLive);

const LimaLive = LimaRuntimeLive.pipe(Layer.provideMerge(DependenciesLive));
const InfrastructureLive = Layer.merge(
  FirecrackerArtifactsLive,
  VmStateLive
).pipe(Layer.provideMerge(LimaLive));
const FirecrackerHostLayer = FirecrackerHostLive.pipe(
  Layer.provideMerge(InfrastructureLive)
);
const AppLive = VmManagerLive.pipe(Layer.provideMerge(FirecrackerHostLayer));

const program = Command.run(weave, { version: "0.0.0" });

program.pipe(Effect.provide(AppLive), BunRuntime.runMain);
