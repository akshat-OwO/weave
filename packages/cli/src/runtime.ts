const runtimeAsset = (() => {
  const system = `${process.platform}:${process.arch}`;

  switch (system) {
    case "darwin:arm64": {
      return "../assets/runtimes/lima-2.2.0-Darwin-arm64.tar.gz";
    }
    case "darwin:x64": {
      return "../assets/runtimes/lima-2.2.0-Darwin-x86_64.tar.gz";
    }
    case "linux:arm64": {
      return "../assets/runtimes/lima-2.2.0-Linux-aarch64.tar.gz";
    }
    case "linux:x64": {
      return "../assets/runtimes/lima-2.2.0-Linux-x86_64.tar.gz";
    }
    case "win32:arm64": {
      return "../assets/runtimes/lima-2.2.0-Windows-ARM64.zip";
    }
    case "win32:x64": {
      return "../assets/runtimes/lima-2.2.0-Windows-AMD64.zip";
    }
    default: {
      throw new Error(`Unsupported system: ${system}`);
    }
  }
})();

const runtimePath = Bun.resolveSync(runtimeAsset, import.meta.dir);

export default runtimePath;
