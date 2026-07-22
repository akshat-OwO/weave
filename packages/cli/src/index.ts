import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Console, Effect } from "effect";
import { Command } from "effect/unstable/cli";

const weave = Command.make("weave", {}, () => Console.log("hello world"));

Command.run(weave, { version: "0.0.0" }).pipe(
  Effect.provide(BunServices.layer),
  BunRuntime.runMain
);
