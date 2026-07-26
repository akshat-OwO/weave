import { expect, test } from "bun:test";

import { Effect } from "effect";

const cliEntry = `${import.meta.dir}/../../src/index.ts`;
const ttlSeconds = 15;
const runningCheckDelay = "5 seconds";
const statusPollDelay = "1 second";
const maximumStatusPolls = 60;
const integrationTestTimeoutMillis = 10 * 60 * 1000;

interface CommandResult {
  readonly stderr: string;
  readonly stdout: string;
}

const runWeave = Effect.fn("weave/tests/integration/runWeave")(
  function* runWeaveHandler(args: readonly string[]) {
    const result = yield* Effect.tryPromise({
      catch: (cause) =>
        new Error(`Failed to execute weave: ${String(cause)}`, { cause }),
      try: async (signal) => {
        const subprocess = Bun.spawn({
          cmd: [process.execPath, cliEntry, ...args],
          env: {
            ...Bun.env,
            CI: "true",
            TERM: "dumb",
          },
          signal,
          stderr: "pipe",
          stdin: "ignore",
          stdout: "pipe",
        });
        const [exitCode, stderr, stdout] = await Promise.all([
          subprocess.exited,
          subprocess.stderr.text(),
          subprocess.stdout.text(),
        ]);

        return { exitCode, stderr, stdout };
      },
    });

    if (result.exitCode !== 0) {
      return yield* Effect.fail(
        new Error(
          `weave ${args.join(" ")} exited with code ${result.exitCode}\n${result.stderr.trim()}`
        )
      );
    }

    return {
      stderr: result.stderr,
      stdout: result.stdout,
    } satisfies CommandResult;
  }
);

const getVmRow = Effect.fn("weave/tests/integration/getVmRow")(
  function* getVmRowHandler(name: string) {
    const { stdout } = yield* runWeave(["list"]);
    const vmLine = stdout
      .split(/\r?\n/u)
      .find(
        (line) => line.startsWith(`${name} `) || line.startsWith(`${name}\t`)
      );

    if (vmLine === undefined) {
      return yield* Effect.fail(
        new Error(`VM ${name} was missing from weave list:\n${stdout.trim()}`)
      );
    }

    return vmLine;
  }
);

const getVmStatus = Effect.fn("weave/tests/integration/getVmStatus")(
  function* getVmStatusHandler(name: string) {
    const vmLine = yield* getVmRow(name);
    const [, status] = vmLine.trim().split(/\s+/u);
    if (status === undefined) {
      return yield* Effect.fail(
        new Error(`VM ${name} had no status in weave list:\n${vmLine}`)
      );
    }

    return status;
  }
);

const waitForStopped = Effect.fn("weave/tests/integration/waitForStopped")(
  function* waitForStoppedHandler(name: string) {
    let lastStatus = "unknown";

    for (let poll = 0; poll < maximumStatusPolls; poll += 1) {
      yield* Effect.sleep(statusPollDelay);
      lastStatus = yield* getVmStatus(name);

      if (lastStatus === "Stopped") {
        return;
      }
    }

    return yield* Effect.fail(
      new Error(
        `VM ${name} remained ${lastStatus} after ${maximumStatusPolls} status polls`
      )
    );
  }
);

test(
  "stops a real Lima VM when its TTL expires",
  async () => {
    const vmName = `weave-ttl-${process.pid}-${Date.now().toString(36)}`;
    const program = Effect.acquireUseRelease(
      Effect.succeed(vmName),
      (name) =>
        Effect.gen(function* ttlIntegrationTest() {
          yield* runWeave(["create", name, "--cpus=1", `--ttl=${ttlSeconds}s`]);
          yield* Effect.sleep(runningCheckDelay);
          expect(yield* getVmStatus(name)).toBe("Running");
          expect(yield* getVmRow(name)).toMatch(/\s\d+s\s+\S+$/u);
          yield* waitForStopped(name);
          expect(yield* getVmStatus(name)).toBe("Stopped");
        }),
      (name) => runWeave(["kill", name]).pipe(Effect.ignore)
    );

    await Effect.runPromise(program);
  },
  integrationTestTimeoutMillis
);
