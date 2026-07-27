import { expect, it } from "@effect/vitest";
import { Effect, Exit } from "effect";

import { CliLifecycleError } from "../../src/schemas/errors/cli-lifecycle.schema";
import {
  compareVersions,
  isCompatibleVersion,
  makeCliLifecycle,
  releaseAssetName,
  selectLatestCompatibleRelease,
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
  install: () => Effect.succeed("/usr/local/bin/weave"),
  remove: Effect.succeed("/usr/local/bin/weave"),
  ...overrides,
});

it("selects the newest compatible stable version without crossing 0.x minors", () => {
  expect(
    selectLatestCompatibleRelease("0.0.1", [
      release("0.0.1"),
      release("0.1.0"),
      release("0.0.3"),
      release("0.0.2"),
    ])?.version
  ).toBe("0.0.3");
  expect(isCompatibleVersion("1.2.3", "1.9.0")).toBe(true);
  expect(isCompatibleVersion("0.2.3", "0.3.0")).toBe(false);
  expect(compareVersions("0.0.10", "0.0.2")).toBeGreaterThan(0);
});

it("maps every supported installation platform to its release asset", () => {
  expect(releaseAssetName("darwin", "arm64")).toBe("weave-bun-darwin-arm64");
  expect(releaseAssetName("linux", "x64")).toBe("weave-bun-linux-x64");
  expect(releaseAssetName("win32", "x64")).toBe("weave-bun-windows-x64.exe");
  expect(releaseAssetName("freebsd", "x64")).toBeUndefined();
});

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
              return "/opt/weave/bin/weave";
            }),
        })
      );

      const result = yield* lifecycle.upgrade("0.0.1");

      expect(result).toEqual({
        _tag: "Upgraded",
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
            return "/usr/local/bin/weave";
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
