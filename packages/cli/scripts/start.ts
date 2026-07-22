import process from "node:process";

type CompileTarget = NonNullable<Bun.CompileBuildOptions["target"]>;

const getCurrentTarget = (): CompileTarget => {
  const system = `${process.platform}:${process.arch}`;

  switch (system) {
    case "darwin:arm64": {
      return "bun-darwin-arm64";
    }
    case "darwin:x64": {
      return "bun-darwin-x64";
    }
    case "linux:arm64": {
      return "bun-linux-arm64";
    }
    case "linux:x64": {
      return "bun-linux-x64";
    }
    case "win32:arm64": {
      return "bun-windows-arm64";
    }
    case "win32:x64": {
      return "bun-windows-x64";
    }
    default: {
      throw new Error(`Unsupported system: ${system}`);
    }
  }
};

const target = getCurrentTarget();
const extension = process.platform === "win32" ? ".exe" : "";
const executable = `${import.meta.dir}/../out/weave-${target}${extension}`;

if (!(await Bun.file(executable).exists())) {
  throw new Error(
    `Executable not found: ${executable}. Run bun run build first.`
  );
}

const subprocess = Bun.spawn([executable, ...Bun.argv.slice(2)], {
  stderr: "inherit",
  stdin: "inherit",
  stdout: "inherit",
});

process.exitCode = await subprocess.exited;
