import path from "node:path";

import type { PlatformError } from "effect";
import {
  Cause,
  Context,
  Effect,
  Exit,
  FileSystem,
  Layer,
  Schema,
} from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { CliLifecycleError } from "../schemas/errors/cli-lifecycle.schema";

const defaultRepository = "akshat-OwO/weave";
const checksumsAssetName = "checksums.txt";
const executableMode = 0o755;
const releasePageSize = 30;

interface ReleaseAsset {
  readonly name: string;
  readonly url: string;
}

export interface CliRelease {
  readonly assets: readonly ReleaseAsset[];
  readonly version: string;
}

export interface LifecycleMutation {
  readonly deferred: boolean;
  readonly path: string;
  readonly recoveryLog?: string;
}

export type UpgradeResult =
  | {
      readonly _tag: "Current";
      readonly installedVersion: string;
    }
  | {
      readonly _tag: "Ahead";
      readonly installedVersion: string;
      readonly latestVersion: string;
    }
  | {
      readonly _tag: "Upgraded";
      readonly deferred: boolean;
      readonly fromVersion: string;
      readonly path: string;
      readonly recoveryLog?: string;
      readonly toVersion: string;
    };

interface SemanticVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

interface GithubAsset {
  readonly browser_download_url: string;
  readonly name: string;
}

interface GithubRelease {
  readonly assets: readonly GithubAsset[];
  readonly draft: boolean;
  readonly prerelease: boolean;
  readonly tag_name: string;
}

const GithubAsset = Schema.Struct({
  browser_download_url: Schema.String,
  name: Schema.String,
});

const GithubRelease = Schema.Struct({
  assets: Schema.Array(GithubAsset),
  draft: Schema.Boolean,
  prerelease: Schema.Boolean,
  tag_name: Schema.String,
});

const GithubReleases = Schema.Array(GithubRelease);

const parseVersion = (version: string): SemanticVersion | undefined => {
  const match = /^v?(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)$/u.exec(
    version
  );
  if (match?.groups === undefined) {
    return undefined;
  }

  const { major, minor, patch } = match.groups;
  if (major === undefined || minor === undefined || patch === undefined) {
    return undefined;
  }

  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
  };
};

export const compareVersions = (left: string, right: string): number => {
  const parsedLeft = parseVersion(left);
  const parsedRight = parseVersion(right);

  if (parsedLeft === undefined || parsedRight === undefined) {
    return left.localeCompare(right);
  }

  return (
    parsedLeft.major - parsedRight.major ||
    parsedLeft.minor - parsedRight.minor ||
    parsedLeft.patch - parsedRight.patch
  );
};

const platformName = (platform: NodeJS.Platform): string | undefined => {
  switch (platform) {
    case "darwin": {
      return "darwin";
    }
    case "linux": {
      return "linux";
    }
    case "win32": {
      return "windows";
    }
    default: {
      return undefined;
    }
  }
};

const architectureName = (architecture: string): string | undefined => {
  switch (architecture) {
    case "arm64": {
      return "arm64";
    }
    case "x64": {
      return "x64";
    }
    default: {
      return undefined;
    }
  }
};

export const releaseAssetName = (
  platform = process.platform,
  architecture = process.arch
): string | undefined => {
  const os = platformName(platform);
  const arch = architectureName(architecture);

  if (os === undefined || arch === undefined) {
    return undefined;
  }

  const extension = os === "windows" ? ".exe" : "";
  return `weave-bun-${os}-${arch}${extension}`;
};

export const selectLatestRelease = (
  releases: readonly CliRelease[]
): CliRelease | undefined =>
  releases.toSorted((left, right) =>
    compareVersions(right.version, left.version)
  )[0];

export const administratorArguments = (
  args: readonly string[],
  interactive = process.stdin.isTTY === true
): readonly string[] => (interactive ? args : ["-n", ...args]);

export interface CliLifecyclePlatformService {
  readonly executablePath: Effect.Effect<string, CliLifecycleError>;
  readonly fetchReleases: Effect.Effect<
    readonly CliRelease[],
    CliLifecycleError
  >;
  readonly install: (
    release: CliRelease
  ) => Effect.Effect<LifecycleMutation, CliLifecycleError>;
  readonly remove: Effect.Effect<LifecycleMutation, CliLifecycleError>;
}

export const CliLifecyclePlatform =
  Context.Service<CliLifecyclePlatformService>(
    "weave/services/cliLifecyclePlatform"
  );

export const CliLifecycle = Context.Service<{
  readonly uninstall: Effect.Effect<LifecycleMutation, CliLifecycleError>;
  readonly upgrade: (
    installedVersion: string
  ) => Effect.Effect<UpgradeResult, CliLifecycleError>;
}>("weave/services/cliLifecycle");

const lifecycleError = (
  phase: CliLifecycleError["phase"],
  detail: string,
  recovery: string
) =>
  new CliLifecycleError({
    detail: detail.length > 0 ? detail : "Unknown failure",
    phase,
    recovery,
  });

const causeDetail = (cause: Cause.Cause<unknown>): string =>
  Cause.pretty(cause).split("\n")[0] ?? "Unknown failure";

export type WindowsDeferredLifecycleOperation =
  | {
      readonly _tag: "Remove";
    }
  | {
      readonly _tag: "Replace";
      readonly stagedPath: string;
    };

export interface WindowsDeferredLifecycleOptions {
  readonly helperPath: string;
  readonly operation: WindowsDeferredLifecycleOperation;
  readonly parentPid: number;
  readonly recoveryLog: string;
  readonly targetPath: string;
}

const escapeBatchValue = (value: string): string =>
  value.replaceAll("%", "%%").replaceAll('"', '""');

export const windowsDeferredLifecycleScript = ({
  helperPath,
  operation,
  parentPid,
  recoveryLog,
  targetPath,
}: WindowsDeferredLifecycleOptions): string => {
  const helper = escapeBatchValue(helperPath);
  const recovery = escapeBatchValue(recoveryLog);
  const target = escapeBatchValue(targetPath);
  const action =
    operation._tag === "Replace"
      ? `move /Y "${escapeBatchValue(operation.stagedPath)}" "${target}" >NUL 2>&1`
      : `del /F /Q "${target}" >NUL 2>&1`;
  const failure =
    operation._tag === "Replace"
      ? `echo Weave could not replace "${target}". The original executable is intact and the verified update remains at "${escapeBatchValue(operation.stagedPath)}".`
      : `echo Weave could not remove "${target}". The executable is intact.`;

  return [
    "@echo off",
    "setlocal",
    ":wait_for_weave",
    `tasklist /FI "PID eq ${parentPid}" /NH 2>NUL | findstr /R /C:"[ ]${parentPid}[ ]" >NUL`,
    "if not errorlevel 1 (",
    "  timeout /T 1 /NOBREAK >NUL",
    "  goto wait_for_weave",
    ")",
    action,
    "if errorlevel 1 (",
    `  >"${recovery}" ${failure}`,
    "  goto cleanup",
    ")",
    `if exist "${recovery}" del /F /Q "${recovery}" >NUL 2>&1`,
    ":cleanup",
    `del /F /Q "${helper}" >NUL 2>&1`,
    "endlocal",
    "",
  ].join("\r\n");
};

export const windowsDeferredLifecycleCommand = (helperPath: string) =>
  ChildProcess.make("cmd.exe", ["/d", "/s", "/c", `"${helperPath}"`], {
    detached: true,
    stderr: "ignore",
    stdin: "ignore",
    stdout: "ignore",
  });

export interface WindowsLifecycleSchedulerDependencies {
  readonly launch: (
    command: ChildProcess.Command
  ) => Effect.Effect<void, unknown>;
  readonly makeHelperPath: Effect.Effect<string, unknown>;
  readonly parentPid: number;
  readonly removeArtifact: (artifactPath: string) => Effect.Effect<void>;
  readonly writeHelper: (
    helperPath: string,
    contents: string
  ) => Effect.Effect<void, unknown>;
}

export const makeWindowsLifecycleScheduler =
  ({
    launch,
    makeHelperPath,
    parentPid,
    removeArtifact,
    writeHelper,
  }: WindowsLifecycleSchedulerDependencies) =>
  (target: string, operation: WindowsDeferredLifecycleOperation) =>
    Effect.gen(function* scheduleWindowsLifecycleHandler() {
      const helperPath = yield* makeHelperPath;
      const recoveryLog = `${helperPath}.error.log`;
      const script = windowsDeferredLifecycleScript({
        helperPath,
        operation,
        parentPid,
        recoveryLog,
        targetPath: target,
      });
      const scheduled = yield* Effect.exit(
        writeHelper(helperPath, script).pipe(
          Effect.andThen(launch(windowsDeferredLifecycleCommand(helperPath)))
        )
      );

      if (Exit.isFailure(scheduled)) {
        yield* removeArtifact(helperPath);
        if (operation._tag === "Replace") {
          yield* removeArtifact(operation.stagedPath);
        }
        return yield* lifecycleError(
          operation._tag === "Replace" ? "replacement" : "removal",
          causeDetail(scheduled.cause),
          operation._tag === "Replace"
            ? `The original binary at ${target} is intact. Verify Windows process permissions and retry.`
            : `The CLI remains at ${target}. Verify Windows process permissions and retry.`
        );
      }

      return {
        deferred: true,
        path: target,
        recoveryLog,
      };
    }).pipe(
      Effect.mapError((error) =>
        error instanceof CliLifecycleError
          ? error
          : lifecycleError(
              operation._tag === "Replace" ? "replacement" : "removal",
              String(error),
              operation._tag === "Replace"
                ? `The original binary at ${target} is intact. Verify temporary-directory permissions and retry.`
                : `The CLI remains at ${target}. Verify temporary-directory permissions and retry.`
            )
      )
    );

const mapPlatformError =
  (phase: CliLifecycleError["phase"], recovery: string) =>
  (error: PlatformError.PlatformError) =>
    lifecycleError(phase, error.message, recovery);

const currentExecutable = Effect.sync(() => {
  const override = Bun.env.WEAVE_INSTALL_PATH;
  if (override !== undefined && override.length > 0) {
    return override;
  }

  return Bun.embeddedFiles.length > 0 ? process.execPath : undefined;
}).pipe(
  Effect.flatMap((executable) =>
    executable === undefined
      ? Effect.fail(
          lifecycleError(
            "installation-path",
            "This command must be run from an installed Weave executable",
            "Install Weave, or set WEAVE_INSTALL_PATH only when testing a local build."
          )
        )
      : Effect.succeed(path.resolve(executable))
  )
);

const fetchGithubReleases = Effect.gen(function* fetchGithubReleasesHandler() {
  const repository = Bun.env.WEAVE_REPOSITORY ?? defaultRepository;
  const response = yield* Effect.tryPromise({
    catch: (error) =>
      lifecycleError(
        "release-check",
        String(error),
        "The installed binary was not changed. Check your network connection and retry `weave upgrade`."
      ),
    try: () =>
      Bun.fetch(
        `https://api.github.com/repos/${repository}/releases?per_page=${releasePageSize}`,
        {
          headers: {
            Accept: "application/vnd.github+json",
            "User-Agent": "weave-cli",
          },
        }
      ),
  });

  if (!response.ok) {
    return yield* lifecycleError(
      "release-check",
      `GitHub returned HTTP ${response.status}`,
      "The installed binary was not changed. Check GitHub availability and retry `weave upgrade`."
    );
  }

  const json = yield* Effect.tryPromise({
    catch: (error) =>
      lifecycleError(
        "release-check",
        `Invalid GitHub response: ${String(error)}`,
        "The installed binary was not changed. Retry `weave upgrade` later."
      ),
    try: () => response.json(),
  });
  const decoded = yield* Schema.decodeUnknownEffect(GithubReleases)(json).pipe(
    Effect.mapError((error) =>
      lifecycleError(
        "release-check",
        `Invalid GitHub release metadata: ${String(error)}`,
        "The installed binary was not changed. Retry `weave upgrade` later."
      )
    )
  );

  return decoded
    .filter(({ draft, prerelease }) => !draft && !prerelease)
    .map(({ assets, tag_name: tagName }) => ({
      assets: assets.map(
        ({ browser_download_url: url, name }): ReleaseAsset => ({
          name,
          url,
        })
      ),
      version: tagName.replace(/^v/u, ""),
    }))
    .filter(({ version }) => parseVersion(version) !== undefined);
});

const downloadAsset = (release: CliRelease) =>
  Effect.gen(function* downloadAssetHandler() {
    const assetName = releaseAssetName();
    if (assetName === undefined) {
      return yield* lifecycleError(
        "download",
        `Unsupported platform ${process.platform}/${process.arch}`,
        "The installed binary was not changed. Install a supported release manually."
      );
    }

    const asset = release.assets.find(({ name }) => name === assetName);
    if (asset === undefined) {
      return yield* lifecycleError(
        "download",
        `Release ${release.version} does not contain ${assetName}`,
        "The installed binary was not changed. Install a compatible release manually or retry later."
      );
    }

    const checksums = release.assets.find(
      ({ name }) => name === checksumsAssetName
    );
    if (checksums === undefined) {
      return yield* lifecycleError(
        "download",
        `Release ${release.version} does not contain ${checksumsAssetName}`,
        "The installed binary was not changed. Retry later or install the release manually after verifying it."
      );
    }

    const fetchReleaseAsset = (url: string) =>
      Effect.tryPromise({
        catch: (error) =>
          lifecycleError(
            "download",
            String(error),
            "The installed binary was not changed. Check your network connection and retry `weave upgrade`."
          ),
        try: () =>
          Bun.fetch(url, {
            headers: { "User-Agent": "weave-cli" },
          }),
      });
    const response = yield* fetchReleaseAsset(asset.url);

    if (!response.ok) {
      return yield* lifecycleError(
        "download",
        `Release download returned HTTP ${response.status}`,
        "The installed binary was not changed. Retry `weave upgrade` later."
      );
    }

    const bytes = yield* Effect.tryPromise({
      catch: (error) =>
        lifecycleError(
          "download",
          String(error),
          "The installed binary was not changed. Retry `weave upgrade`."
        ),
      try: async () => new Uint8Array(await response.arrayBuffer()),
    });
    const checksumsResponse = yield* fetchReleaseAsset(checksums.url);
    if (!checksumsResponse.ok) {
      return yield* lifecycleError(
        "download",
        `Checksum download returned HTTP ${checksumsResponse.status}`,
        "The installed binary was not changed. Retry `weave upgrade` later."
      );
    }

    const checksumText = yield* Effect.tryPromise({
      catch: (error) =>
        lifecycleError(
          "download",
          `Could not read release checksums: ${String(error)}`,
          "The installed binary was not changed. Retry `weave upgrade` later."
        ),
      try: () => checksumsResponse.text(),
    });
    const checksumLine = checksumText
      .split(/\r?\n/u)
      .find((line) => line.trimEnd().endsWith(assetName));
    const expectedChecksum = checksumLine?.trim().split(/\s+/u)[0];
    const actualChecksum = new Bun.CryptoHasher("sha256")
      .update(bytes)
      .digest("hex");

    if (
      expectedChecksum === undefined ||
      expectedChecksum.toLowerCase() !== actualChecksum
    ) {
      return yield* lifecycleError(
        "download",
        `Checksum verification failed for ${assetName}`,
        "The installed binary was not changed. Retry later and do not install the unverified download."
      );
    }

    return bytes;
  });

const writeBytes = (filePath: string, bytes: Uint8Array) =>
  Effect.tryPromise({
    catch: (error) => error,
    try: () => Bun.write(filePath, bytes),
  });

export const CliLifecyclePlatformLive = Layer.effect(
  CliLifecyclePlatform,
  Effect.gen(function* cliLifecyclePlatformHandler() {
    const fs = yield* FileSystem.FileSystem;
    const processSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;

    const scheduleWindowsLifecycle = makeWindowsLifecycleScheduler({
      launch: (command) =>
        Effect.scoped(
          Effect.gen(function* launchHelperHandler() {
            const handle = yield* processSpawner.spawn(command);
            yield* handle.unref;
          })
        ),
      makeHelperPath: fs.makeTempFile({
        prefix: "weave-lifecycle-",
        suffix: ".cmd",
      }),
      parentPid: process.pid,
      removeArtifact: (artifactPath) =>
        fs.remove(artifactPath, { force: true }).pipe(Effect.ignore),
      writeHelper: (helperPath, contents) =>
        Effect.tryPromise({
          catch: (error) => error,
          try: () => Bun.write(helperPath, contents),
        }).pipe(Effect.asVoid),
    });

    const runPrivileged = (args: readonly string[]) =>
      processSpawner
        .exitCode(
          ChildProcess.make("sudo", administratorArguments(args), {
            stderr: "inherit",
            stdin: "inherit",
            stdout: "inherit",
          })
        )
        .pipe(
          Effect.mapError(
            mapPlatformError(
              "replacement",
              "The installed binary was not changed. Retry with administrator access or install manually."
            )
          ),
          Effect.flatMap((exitCode) =>
            exitCode === 0
              ? Effect.void
              : Effect.fail(
                  lifecycleError(
                    "replacement",
                    `Administrator command exited with code ${exitCode}`,
                    "The installed binary was not changed. Retry with administrator access or install manually."
                  )
                )
          )
        );

    const installDirectly = (target: string, bytes: Uint8Array) =>
      Effect.scoped(
        Effect.gen(function* installDirectlyHandler() {
          const temporary = yield* fs.makeTempFileScoped({
            directory: path.dirname(target),
            prefix: ".weave-upgrade-",
          });
          yield* writeBytes(temporary, bytes);
          if (process.platform !== "win32") {
            yield* fs.chmod(temporary, executableMode);
          }
          yield* fs.rename(temporary, target);
        })
      );

    const installPrivileged = (target: string, bytes: Uint8Array) =>
      Effect.scoped(
        Effect.gen(function* installPrivilegedHandler() {
          if (process.platform === "win32") {
            return yield* lifecycleError(
              "replacement",
              "Windows prevented replacement of the running executable",
              `The installed binary is intact. Download the update and replace ${target} after Weave exits.`
            );
          }

          const source = yield* fs.makeTempFileScoped({
            prefix: "weave-upgrade-",
          });
          const stagedTarget = `${target}.weave-new-${process.pid}`;
          yield* writeBytes(source, bytes).pipe(
            Effect.mapError((error) =>
              lifecycleError(
                "replacement",
                String(error),
                "The installed binary was not changed. Verify temporary-directory permissions and retry."
              )
            )
          );
          yield* fs
            .chmod(source, executableMode)
            .pipe(
              Effect.mapError(
                mapPlatformError(
                  "replacement",
                  "The installed binary was not changed. Verify temporary-directory permissions and retry."
                )
              )
            );
          yield* runPrivileged(["install", "-m", "755", source, stagedTarget]);
          const replacement = yield* Effect.exit(
            runPrivileged(["mv", "-f", stagedTarget, target])
          );
          if (Exit.isFailure(replacement)) {
            yield* runPrivileged(["rm", "-f", stagedTarget]).pipe(
              Effect.ignore
            );
            return yield* lifecycleError(
              "replacement",
              causeDetail(replacement.cause),
              `The original binary at ${target} is intact. Retry with administrator access or install manually.`
            );
          }
        })
      );

    const installOnWindows = (target: string, bytes: Uint8Array) =>
      Effect.gen(function* installOnWindowsHandler() {
        const stagedPath = `${target}.weave-new-${process.pid}-${crypto.randomUUID()}`;
        const written = yield* Effect.exit(writeBytes(stagedPath, bytes));
        if (Exit.isFailure(written)) {
          yield* fs.remove(stagedPath, { force: true }).pipe(Effect.ignore);
          return yield* lifecycleError(
            "replacement",
            causeDetail(written.cause),
            `The original binary at ${target} is intact. Verify installation-directory permissions and retry.`
          );
        }

        return yield* scheduleWindowsLifecycle(target, {
          _tag: "Replace",
          stagedPath,
        });
      });

    const install = (release: CliRelease) =>
      Effect.gen(function* installHandler() {
        const target = yield* currentExecutable;
        const bytes = yield* downloadAsset(release);
        if (process.platform === "win32") {
          return yield* installOnWindows(target, bytes);
        }

        const direct = yield* Effect.exit(installDirectly(target, bytes));

        if (Exit.isFailure(direct)) {
          yield* installPrivileged(target, bytes).pipe(
            Effect.mapError((error) =>
              error instanceof CliLifecycleError
                ? error
                : lifecycleError(
                    "replacement",
                    String(error),
                    `The original binary at ${target} is intact. Verify permissions and retry.`
                  )
            )
          );
        }

        return { deferred: false, path: target };
      });

    const remove = Effect.gen(function* removeHandler() {
      const target = yield* currentExecutable;
      if (process.platform === "win32") {
        return yield* scheduleWindowsLifecycle(target, { _tag: "Remove" });
      }

      const direct = yield* Effect.exit(fs.remove(target));
      if (Exit.isSuccess(direct)) {
        return { deferred: false, path: target };
      }

      const sudoArguments = ["rm", "--", target];
      const exitCode = yield* processSpawner
        .exitCode(
          ChildProcess.make("sudo", administratorArguments(sudoArguments), {
            stderr: "inherit",
            stdin: "inherit",
            stdout: "inherit",
          })
        )
        .pipe(
          Effect.mapError(
            mapPlatformError(
              "removal",
              `VMs and data were retained. Remove ${target} manually from an interactive terminal.`
            )
          )
        );
      if (exitCode !== 0) {
        return yield* lifecycleError(
          "removal",
          `Administrator command exited with code ${exitCode}`,
          `VMs and data were retained. Remove ${target} manually from an interactive terminal.`
        );
      }

      return { deferred: false, path: target };
    });

    return CliLifecyclePlatform.of({
      executablePath: currentExecutable,
      fetchReleases: fetchGithubReleases,
      install,
      remove,
    });
  })
);

export const makeCliLifecycle = (platform: CliLifecyclePlatformService) =>
  CliLifecycle.of({
    uninstall: platform.remove,
    upgrade: (installedVersion) =>
      Effect.gen(function* upgradeHandler() {
        const releases = yield* platform.fetchReleases;
        const latest = selectLatestRelease(releases);

        if (latest === undefined) {
          return {
            _tag: "Current",
            installedVersion,
          };
        }

        const comparison = compareVersions(latest.version, installedVersion);
        if (comparison === 0) {
          return {
            _tag: "Current",
            installedVersion,
          };
        }
        if (comparison < 0) {
          return {
            _tag: "Ahead",
            installedVersion,
            latestVersion: latest.version,
          };
        }

        const installed = yield* platform.install(latest);
        return {
          _tag: "Upgraded",
          deferred: installed.deferred,
          fromVersion: installedVersion,
          path: installed.path,
          ...(installed.recoveryLog === undefined
            ? {}
            : { recoveryLog: installed.recoveryLog }),
          toVersion: latest.version,
        };
      }),
  });

export const CliLifecycleLive = Layer.effect(
  CliLifecycle,
  Effect.gen(function* cliLifecycleHandler() {
    const platform = yield* CliLifecyclePlatform;
    return makeCliLifecycle(platform);
  })
);
