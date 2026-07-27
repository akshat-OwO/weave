import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  access,
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  readlink,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const installScript = path.join(import.meta.dirname, "..", "install.sh");
const testDirectories: string[] = [];

const makeExecutable = async (filePath: string, contents: string) => {
  await writeFile(filePath, contents);
  await chmod(filePath, 0o755);
};

const pathExists = async (filePath: string) => {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
};

const runProcess = async (
  command: string,
  arguments_: string[],
  environment: NodeJS.ProcessEnv
): Promise<{ exitCode: number; stderr: string; stdout: string }> => {
  const child = spawn(command, arguments_, { env: environment });
  const stderr: Buffer[] = [];
  const stdout: Buffer[] = [];

  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
  child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));

  const [exitCode] = (await once(child, "close")) as [number | null];

  return {
    exitCode: exitCode ?? 1,
    stderr: Buffer.concat(stderr).toString(),
    stdout: Buffer.concat(stdout).toString(),
  };
};

const runInstaller = (
  environment: NodeJS.ProcessEnv,
  interactive: boolean
): Promise<{ exitCode: number; stderr: string; stdout: string }> => {
  if (interactive) {
    return runProcess(
      "script",
      ["-qefc", `/bin/sh '${installScript}'`, "/dev/null"],
      environment
    );
  }

  return runProcess("sh", [installScript], environment);
};

const makeVersionBinary = async (filePath: string, versionOutput: string) => {
  await makeExecutable(
    filePath,
    `#!/bin/sh
if [ "\${1:-}" = "--version" ]; then
  printf '%s\\n' '${versionOutput}'
  exit 0
fi
printf 'test binary\\n'
`
  );
};

const makeHarness = async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "weave-install-test-"));
  const toolsDirectory = path.join(directory, "tools");
  const installDirectory = path.join(directory, "install");
  const assetPath = path.join(directory, "release-asset");
  const downloadLogPath = path.join(directory, "downloads.log");

  testDirectories.push(directory);
  await mkdir(toolsDirectory);
  await mkdir(installDirectory);
  await makeExecutable(
    path.join(toolsDirectory, "curl"),
    `#!/bin/sh
set -eu

output_path=""
download_url=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --output)
      shift
      output_path="$1"
      ;;
    http://* | https://*)
      download_url="$1"
      ;;
  esac
  shift
done

if [ -n "\${WEAVE_TEST_DOWNLOAD_DELAY:-}" ]; then
  sleep "$WEAVE_TEST_DOWNLOAD_DELAY"
fi

case "$download_url" in
  https://api.github.com/*)
    printf '{"tag_name":"%s"}\\n' "$WEAVE_TEST_LATEST_TAG" > "$output_path"
    ;;
  *)
    printf '%s\\n' "$download_url" >> "$WEAVE_TEST_DOWNLOAD_LOG"
    if [ "\${WEAVE_TEST_DOWNLOAD_FAIL:-0}" = "1" ]; then
      exit 22
    fi
    cp "$WEAVE_TEST_ASSET" "$output_path"
    ;;
esac
`
  );

  const run = (
    environment: Record<string, string> = {},
    interactive = false
  ): Promise<{ exitCode: number; stderr: string; stdout: string }> =>
    runInstaller(
      {
        ...process.env,
        CI: "",
        PATH: `${toolsDirectory}:${process.env.PATH ?? ""}`,
        TERM: "xterm-256color",
        WEAVE_INSTALL_DIR: installDirectory,
        WEAVE_TEST_ASSET: assetPath,
        WEAVE_TEST_DOWNLOAD_LOG: downloadLogPath,
        WEAVE_TEST_LATEST_TAG: "v1.2.3",
        WEAVE_UNAME_M: "x86_64",
        WEAVE_UNAME_S: "Linux",
        ...environment,
      },
      interactive
    );

  return {
    assetPath,
    downloadLogPath,
    installDirectory,
    installedBinary: path.join(installDirectory, "weave"),
    run,
    toolsDirectory,
  };
};

afterEach(async () => {
  await Promise.all(
    testDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true }))
  );
});

describe("install script", () => {
  it("installs the latest release when Weave is not installed", async () => {
    const harness = await makeHarness();
    await makeVersionBinary(harness.assetPath, "weave v1.2.3");

    const result = await harness.run();

    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    expect(result.stdout).toContain("Weave was installed");
    expect(await readFile(harness.downloadLogPath, "utf-8")).toContain(
      "/releases/download/v1.2.3/weave-bun-linux-x64"
    );
    expect(
      await runProcess(harness.installedBinary, ["--version"], process.env)
    ).toMatchObject({ exitCode: 0, stdout: "weave v1.2.3\n" });
  });

  it("uses stable line-oriented progress when output is redirected", async () => {
    const harness = await makeHarness();
    await makeVersionBinary(harness.assetPath, "weave v1.2.3");

    const result = await harness.run();
    const output = result.stdout + result.stderr;

    expect(result.exitCode).toBe(0);
    expect(output).toContain("Checking the latest Weave release...\n");
    expect(output).toContain("Checked the latest Weave release.\n");
    expect(output).toContain("Downloading Weave 1.2.3 for linux/x64...\n");
    expect(output).toContain("Validating the downloaded Weave binary...\n");
    expect(output).toContain(
      `Staging Weave in ${harness.installDirectory}...\n`
    );
    expect(output).toContain(
      `Atomically installing Weave to ${harness.installedBinary}...\n`
    );
    expect(output).not.toContain("\u001B[2K");
  });

  it.runIf(process.platform === "linux")(
    "animates and replaces progress lines in an interactive terminal",
    async () => {
      const harness = await makeHarness();
      await makeVersionBinary(harness.assetPath, "weave v1.2.3");

      const result = await harness.run(
        { WEAVE_TEST_DOWNLOAD_DELAY: "0.3" },
        true
      );

      expect(result.exitCode, result.stdout + result.stderr).toBe(0);
      expect(
        ["-", "\\", "|", "/"].some((frame) =>
          result.stdout.includes(
            `\r\u001B[2K${frame} Checking the latest Weave release`
          )
        )
      ).toBe(true);
      expect(result.stdout).toContain(
        "\r\u001B[2KChecked the latest Weave release."
      );
      expect(result.stdout).not.toContain(
        "Checking the latest Weave release...\r\n"
      );
    }
  );

  it("does not download an asset when the installed release is current", async () => {
    const harness = await makeHarness();
    await makeVersionBinary(harness.installedBinary, "weave v1.2.3");

    const result = await harness.run();

    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    expect(result.stdout).toContain("already up to date");
    expect(result.stdout).not.toContain("Downloading Weave");
    expect(await pathExists(harness.downloadLogPath)).toBe(false);
  });

  it("detects an existing installation on PATH with the default location", async () => {
    const harness = await makeHarness();
    const pathBinary = path.join(harness.toolsDirectory, "weave.exe");
    await makeVersionBinary(pathBinary, "weave v1.2.3");

    const result = await harness.run({
      HOME: harness.installDirectory,
      WEAVE_INSTALL_DIR: "",
      WEAVE_UNAME_S: "MINGW64_NT",
    });

    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    expect(result.stdout).toContain(`already up to date at ${pathBinary}`);
    expect(await pathExists(harness.downloadLogPath)).toBe(false);
  });

  it("preserves a symlink-managed installation discovered on PATH", async () => {
    const harness = await makeHarness();
    const managedBinary = path.join(harness.installDirectory, "managed-weave");
    const pathBinary = path.join(harness.toolsDirectory, "weave.exe");
    await makeVersionBinary(managedBinary, "weave v1.2.2");
    await symlink(managedBinary, pathBinary);

    const originalBinary = await readFile(managedBinary, "utf-8");
    const result = await harness.run({
      HOME: harness.installDirectory,
      WEAVE_INSTALL_DIR: "",
      WEAVE_UNAME_S: "MINGW64_NT",
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "is a symbolic link; upgrade it with the tool that manages the link"
    );
    expect(await readlink(pathBinary)).toBe(managedBinary);
    expect(await readFile(managedBinary, "utf-8")).toBe(originalBinary);
    expect(await pathExists(harness.downloadLogPath)).toBe(false);
  });

  it("atomically upgrades an older installed release", async () => {
    const harness = await makeHarness();
    await makeVersionBinary(harness.installedBinary, "weave v1.2.2");
    await makeVersionBinary(harness.assetPath, "weave v1.2.3");

    const result = await harness.run();

    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    expect(result.stdout).toContain("Upgrading Weave from 1.2.2 to 1.2.3");
    expect(
      await runProcess(harness.installedBinary, ["--version"], process.env)
    ).toMatchObject({ exitCode: 0, stdout: "weave v1.2.3\n" });
  });

  it("leaves an installed release newer than the requested release unchanged", async () => {
    const harness = await makeHarness();
    await makeVersionBinary(harness.installedBinary, "weave v2.0.0");

    const originalBinary = await readFile(harness.installedBinary, "utf-8");
    const result = await harness.run();

    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    expect(result.stdout).toContain("newer than release 1.2.3");
    expect(await readFile(harness.installedBinary, "utf-8")).toBe(
      originalBinary
    );
    expect(await pathExists(harness.downloadLogPath)).toBe(false);
  });

  it.each(["weave development", "weave v1.2.3-dev.1"])(
    "refuses to replace an installed development or malformed version: %s",
    async (versionOutput) => {
      const harness = await makeHarness();
      await makeVersionBinary(harness.installedBinary, versionOutput);

      const originalBinary = await readFile(harness.installedBinary, "utf-8");
      const result = await harness.run();

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("refusing to replace it automatically");
      expect(await readFile(harness.installedBinary, "utf-8")).toBe(
        originalBinary
      );
      expect(await pathExists(harness.downloadLogPath)).toBe(false);
    }
  );

  it("preserves the installed binary when an upgrade download fails", async () => {
    const harness = await makeHarness();
    await makeVersionBinary(harness.installedBinary, "weave v1.2.2");

    const originalBinary = await readFile(harness.installedBinary, "utf-8");
    const result = await harness.run({ WEAVE_TEST_DOWNLOAD_FAIL: "1" });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "failed to download Weave 1.2.3; the existing installation was not changed"
    );
    expect(result.stderr).toContain("existing installation was not changed");
    expect(result.stderr).not.toContain("\u001B[2K");
    expect(await readFile(harness.installedBinary, "utf-8")).toBe(
      originalBinary
    );
  });
});
