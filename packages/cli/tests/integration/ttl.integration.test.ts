import { expect, test } from "bun:test";

import { Effect, Option } from "effect";

const cliEntry = `${import.meta.dir}/../../src/index.ts`;
const ttlSeconds = 15;
const setupTtl = "15m";
const runningCheckDelay = "5 seconds";
const statusPollDelay = "1 second";
const maximumStatusPolls = 60;
const vitePollDelay = "1 second";
const maximumVitePolls = 60;
const parentViteUrl = "http://127.0.0.1:3005";
const viteAppTitle = "<title>vite-app</title>";
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

const waitForVite = Effect.fn("weave/tests/integration/waitForVite")(
  function* waitForViteHandler(name: string) {
    for (let poll = 0; poll < maximumVitePolls; poll += 1) {
      const response = yield* Effect.tryPromise({
        catch: () => new Error(`Vite was not ready at ${parentViteUrl}`),
        try: () =>
          fetch(parentViteUrl, {
            cache: "no-store",
            signal: AbortSignal.timeout(2000),
          }).then(async (result) => ({
            body: await result.text(),
            ok: result.ok,
          })),
      }).pipe(Effect.option);

      if (
        Option.isSome(response) &&
        response.value.ok &&
        response.value.body.includes(viteAppTitle)
      ) {
        return response.value.body;
      }

      yield* Effect.sleep(vitePollDelay);
    }

    const { stdout: viteLog } = yield* runWeave([
      "shell",
      name,
      "cat /tmp/weave-vite.log 2>/dev/null || true",
    ]);
    return yield* Effect.fail(
      new Error(
        `Vite did not respond at ${parentViteUrl} after ${maximumVitePolls} polls:\n${viteLog.trim()}`
      )
    );
  }
);

const startVite = (name: string) =>
  runWeave([
    "shell",
    name,
    "cd ~/vite-app && setsid --fork npm run dev -- --host 127.0.0.1 --port 5173 </dev/null >/tmp/weave-vite.log 2>&1",
  ]);

test(
  "publishes a Vite app and stops the VM when its TTL expires",
  async () => {
    const vmName = `weave-ttl-${process.pid}-${Date.now().toString(36)}`;
    const program = Effect.acquireUseRelease(
      Effect.succeed(vmName),
      (name) =>
        Effect.gen(function* ttlIntegrationTest() {
          const creation = yield* runWeave([
            "create",
            name,
            "--cpus=1",
            `--ttl=${setupTtl}`,
            "--template=node",
          ]);
          expect(creation.stdout).toContain("Cloning cached environment…");
          yield* runWeave([
            "shell",
            name,
            "npm_config_yes=true npm create vite@9.1.2 vite-app -- --template vanilla && cd vite-app && npm install",
          ]);
          yield* runWeave(["port", "add", name, "3005:5173"]);
          const publishedPorts = yield* runWeave(["port", "ls", name]);
          expect(publishedPorts.stdout).toContain("127.0.0.1:3005\t5173\ttcp");
          yield* startVite(name);
          expect(yield* waitForVite(name)).toContain(viteAppTitle);

          yield* runWeave(["stop", name]);
          yield* runWeave(["start", name, `--ttl=${ttlSeconds}s`]);
          yield* startVite(name);
          expect(yield* waitForVite(name)).toContain(viteAppTitle);
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
