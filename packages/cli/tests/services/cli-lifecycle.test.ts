import { expect, it } from "@effect/vitest";
import { Effect, Exit } from "effect";

import { CliLifecycleError } from "../../src/schemas/errors/cli-lifecycle.schema";
import {
  administratorArguments,
  compareVersions,
  makeCliLifecycle,
  makeWindowsLifecycleScheduler,
  releaseAssetName,
  selectLatestRelease,
  windowsDeferredLifecycleCommand,
  windowsDeferredLifecycleScript,
} from "../../src/services/cli-lifecycle";
import type { CliLifecyclePlatformService } from "../../src/services/cli-lifecycle";

const release = (version: string) => ({
  assets: [],
  version,
});

const makePlatform = (
  overrides: Partial<CliLifecyclePlatformService> = {}
): CliLifecyclePlatformService => ({
  executablePath: Effect.succeed("/usr/local/bin/weave"),
  fetchReleases: Effect.succeed([release("0.0.2")]),
  install: () =>
    Effect.succeed({ deferred: false, path: "/usr/local/bin/weave" }),
  remove: Effect.succeed({
    deferred: false,
    path: "/usr/local/bin/weave",
  }),
  ...overrides,
});

it("prevents sudo password prompts without an interactive terminal", () => {
  const args = ["rm", "--", "/usr/local/bin/weave"];

  expect(administratorArguments(args, false)).toEqual(["-n", ...args]);
  expect(administratorArguments(args, true)).toBe(args);
});

it("selects the newest stable release across minor and major versions", () => {
  expect(
    selectLatestRelease([
      release("0.0.1"),
      release("0.1.0"),
      release("0.0.3"),
      release("0.0.2"),
    ])?.version
  ).toBe("0.1.0");
  expect(
    selectLatestRelease([release("1.9.0"), release("2.0.0"), release("1.10.0")])
      ?.version
  ).toBe("2.0.0");
  expect(compareVersions("0.0.10", "0.0.2")).toBeGreaterThan(0);
});

it("maps every supported installation platform to its release asset", () => {
  expect(releaseAssetName("darwin", "arm64")).toBe("weave-bun-darwin-arm64");
  expect(releaseAssetName("linux", "x64")).toBe("weave-bun-linux-x64");
  expect(releaseAssetName("win32", "x64")).toBe("weave-bun-windows-x64.exe");
  expect(releaseAssetName("freebsd", "x64")).toBeUndefined();
});

it("constructs a detached Windows helper command", () => {
  const command = windowsDeferredLifecycleCommand(
    "C:\\Temp\\weave-lifecycle.cmd"
  );

  expect(command).toMatchObject({
    _tag: "StandardCommand",
    args: ["/d", "/s", "/c", '"C:\\Temp\\weave-lifecycle.cmd"'],
    command: "cmd.exe",
    options: {
      detached: true,
      stderr: "ignore",
      stdin: "ignore",
      stdout: "ignore",
    },
  });
});

it("builds a Windows replacement helper that waits, preserves the original on failure, and self-cleans", () => {
  const script = windowsDeferredLifecycleScript({
    helperPath: "C:\\Temp\\weave-lifecycle.cmd",
    operation: {
      _tag: "Replace",
      stagedPath: "C:\\Tools\\weave.exe.weave-new",
    },
    parentPid: 4242,
    recoveryLog: "C:\\Temp\\weave-lifecycle.error.log",
    targetPath: "C:\\Tools\\weave.exe",
  });

  expect(script).toContain('tasklist /FI "PID eq 4242"');
  expect(script).toContain(
    'move /Y "C:\\Tools\\weave.exe.weave-new" "C:\\Tools\\weave.exe"'
  );
  expect(script).toContain("The original executable is intact");
  expect(script).toContain('del /F /Q "C:\\Temp\\weave-lifecycle.cmd"');
});

it("builds a Windows removal helper that deletes only after the parent exits", () => {
  const script = windowsDeferredLifecycleScript({
    helperPath: "C:\\Temp\\weave-uninstall.cmd",
    operation: { _tag: "Remove" },
    parentPid: 99,
    recoveryLog: "C:\\Temp\\weave-uninstall.error.log",
    targetPath: "C:\\Tools\\weave.exe",
  });

  expect(script.indexOf('tasklist /FI "PID eq 99"')).toBeLessThan(
    script.indexOf('del /F /Q "C:\\Tools\\weave.exe"')
  );
  expect(script).toContain("The executable is intact");
});

it.effect(
  "preserves the Windows executable and cleans staged artifacts when helper scheduling fails",
  () =>
    Effect.gen(function* windowsSchedulingFailureTest() {
      const removed: string[] = [];
      const target = "C:\\Tools\\weave.exe";
      const staged = "C:\\Tools\\weave.exe.weave-new";
      const schedule = makeWindowsLifecycleScheduler({
        launch: () => Effect.fail("could not spawn detached helper"),
        makeHelperPath: Effect.succeed("C:\\Temp\\weave-lifecycle.cmd"),
        parentPid: 4242,
        removeArtifact: (artifactPath) =>
          Effect.sync(() => {
            removed.push(artifactPath);
          }),
        writeHelper: () => Effect.void,
      });

      const exit = yield* Effect.exit(
        schedule(target, { _tag: "Replace", stagedPath: staged })
      );

      expect(Exit.isFailure(exit)).toBe(true);
      expect(removed).toEqual(["C:\\Temp\\weave-lifecycle.cmd", staged]);
      expect(removed).not.toContain(target);
    })
);

it.effect(
  "installs an upgrade at the platform-provided installation path",
  () =>
    Effect.gen(function* upgradeServiceTest() {
      const installed: string[] = [];
      const lifecycle = makeCliLifecycle(
        makePlatform({
          install: ({ version }) =>
            Effect.sync(() => {
              installed.push(version);
              return {
                deferred: false,
                path: "/opt/weave/bin/weave",
              };
            }),
        })
      );

      const result = yield* lifecycle.upgrade("0.0.1");

      expect(result).toEqual({
        _tag: "Upgraded",
        deferred: false,
        fromVersion: "0.0.1",
        path: "/opt/weave/bin/weave",
        toVersion: "0.0.2",
      });
      expect(installed).toEqual(["0.0.2"]);
    })
);

it.effect("does not reinstall or downgrade a current or newer binary", () =>
  Effect.gen(function* noOpServiceTest() {
    const installs: string[] = [];
    const lifecycle = makeCliLifecycle(
      makePlatform({
        fetchReleases: Effect.succeed([release("0.0.2")]),
        install: ({ version }) =>
          Effect.sync(() => {
            installs.push(version);
            return {
              deferred: false,
              path: "/usr/local/bin/weave",
            };
          }),
      })
    );

    expect(yield* lifecycle.upgrade("0.0.2")).toEqual({
      _tag: "Current",
      installedVersion: "0.0.2",
    });
    expect(yield* lifecycle.upgrade("0.0.3")).toEqual({
      _tag: "Ahead",
      installedVersion: "0.0.3",
      latestVersion: "0.0.2",
    });
    expect(installs).toEqual([]);
  })
);

it.effect("preserves structured network and replacement failures", () =>
  Effect.gen(function* failureServiceTest() {
    const networkError = new CliLifecycleError({
      detail: "offline",
      phase: "release-check",
      recovery: "retry",
    });
    const replacementError = new CliLifecycleError({
      detail: "rename failed",
      phase: "replacement",
      recovery: "original retained",
    });

    const networkExit = yield* Effect.exit(
      makeCliLifecycle(
        makePlatform({ fetchReleases: Effect.fail(networkError) })
      ).upgrade("0.0.1")
    );
    const replacementExit = yield* Effect.exit(
      makeCliLifecycle(
        makePlatform({ install: () => Effect.fail(replacementError) })
      ).upgrade("0.0.1")
    );

    expect(Exit.isFailure(networkExit)).toBe(true);
    expect(Exit.isFailure(replacementExit)).toBe(true);
  })
);
