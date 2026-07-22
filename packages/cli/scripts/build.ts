import type { BuildOutput } from "bun";
import type { Cause } from "effect";
import { Effect, Context, Console } from "effect";

const CliBuilder = Context.Service<{
  build: (
    target: Bun.CompileBuildOptions["target"]
  ) => Effect.Effect<BuildOutput, Cause.UnknownError>;
}>("weave/cli/scripts/build/cliBuilder");

const buildConf = (target: Bun.CompileBuildOptions["target"]) =>
  ({
    compile: {
      outfile: `./out/weave-${target}`,
      target,
    },
    entrypoints: ["src/index.ts"],
    minify: true,
    sourcemap: "linked",
    throw: false,
  }) satisfies Bun.BuildConfig;

const TARGETS = [
  "bun-linux-x64",
  "bun-linux-arm64",
  "bun-windows-x64",
  "bun-windows-arm64",
  "bun-darwin-x64",
  "bun-darwin-arm64",
] as const;

const CliBuilderLive = Context.make(CliBuilder, {
  build: (target) =>
    Effect.gen(function* builder() {
      yield* Console.log(`Building for ${target}...`);
      const result = yield* Effect.tryPromise(() =>
        Bun.build(buildConf(target))
      );

      if (result.success) {
        yield* Console.log(`Successfully built for ${target}`);
        yield* Console.log(`Output: ${result.outputs[0]?.path}`);
      } else {
        yield* Console.error(`Failed to build for ${target}`);
        yield* Console.log(result.logs);
      }

      return result;
    }),
});

const program = Effect.gen(function* handler() {
  const cliBuilder = yield* CliBuilder;

  return yield* Effect.forEach(TARGETS, (target) => cliBuilder.build(target), {
    concurrency: 1,
  });
}).pipe(Effect.provide(CliBuilderLive));

await Effect.runPromise(program);
