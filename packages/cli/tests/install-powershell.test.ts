import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const installerPath = path.join(import.meta.dirname, "..", "install.ps1");

describe("PowerShell installer", () => {
  it("downloads non-interactively and verifies the checksum before installing Weave", async () => {
    const installer = await readFile(installerPath, "utf-8");
    const checksumVerification = installer.indexOf("Get-FileHash");
    const installation = installer.indexOf("Move-Item -Force");

    expect(installer.match(/-UseBasicParsing/gu)).toHaveLength(2);
    expect(checksumVerification).toBeGreaterThan(-1);
    expect(installation).toBeGreaterThan(checksumVerification);
    expect(installer).toContain("checksums.txt");
  });

  it("installs QEMU non-interactively through the exact WinGet package", async () => {
    const installer = await readFile(installerPath, "utf-8");

    expect(installer).toContain(
      '$QemuPackage = "SoftwareFreedomConservancy.QEMU"'
    );
    expect(installer).toContain("--exact");
    expect(installer).toContain("--silent");
    expect(installer).toContain("--accept-package-agreements");
    expect(installer).toContain("--accept-source-agreements");
  });

  it("persists the Weave and QEMU discovery configuration", async () => {
    const installer = await readFile(installerPath, "utf-8");
    const qemuConfiguration = installer.lastIndexOf(
      "Install-WeaveQemu -Executable"
    );
    const installation = installer.indexOf("Move-Item -Force");
    const pathConfiguration = installer.lastIndexOf(
      "Add-WeaveUserPath -Directory"
    );

    expect(installer).toContain(
      '[Environment]::SetEnvironmentVariable("Path", $updatedPath, "User")'
    );
    expect(installer).toContain(
      '[Environment]::SetEnvironmentVariable($Variable, $qemuPath, "User")'
    );
    expect(installer).toContain(
      '"QEMU_SYSTEM_$($architecture.Qemu.ToUpperInvariant())"'
    );
    expect(qemuConfiguration).toBeGreaterThan(-1);
    expect(installation).toBeGreaterThan(qemuConfiguration);
    expect(pathConfiguration).toBeGreaterThan(installation);
  });
});
