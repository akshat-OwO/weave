import { expect, it } from "@effect/vitest";
import { Option } from "effect";

import {
  decodeLimaLogLine,
  formatDownloadBytes,
  formatLimaLog,
  formatProgressElapsed,
  limaActionableDiagnosticLine,
  limaFailureMessage,
  limaPackageDownloadBytes,
  limaPackageDownloadPhase,
  limaProgressLine,
  limaProgressMessage,
} from "../../src/lib/lima-progress";

it("decodes and formats structured Lima logs", () => {
  const decoded = decodeLimaLogLine(
    '{"level":"info","msg":"Guest agent is running","time":"now"}'
  );

  expect(Option.getOrUndefined(decoded)).toEqual({
    level: "info",
    msg: "Guest agent is running",
  });
  expect(decoded.pipe(Option.map(formatLimaLog), Option.getOrUndefined)).toBe(
    "INFO Guest agent is running"
  );
});

it("maps Lima readiness messages to coarse milestones", () => {
  expect(
    Option.getOrUndefined(
      limaProgressMessage(
        "Downloading the image (ubuntu-24.04-server-cloudimg-arm64.img)"
      )
    )
  ).toBe("Downloading VM image…");
  expect(
    Option.getOrUndefined(
      limaProgressMessage(
        "Decompressing the image (ubuntu-24.04-server-cloudimg-arm64.img)"
      )
    )
  ).toBe("Preparing VM image…");
  expect(
    Option.getOrUndefined(
      limaProgressMessage(
        'Converting the image to raw sparse format in cache: "/tmp/image"'
      )
    )
  ).toBe("Preparing VM image…");
  expect(
    Option.getOrUndefined(
      limaProgressMessage(
        "Waiting for the essential requirement: `user session is ready for ssh`"
      )
    )
  ).toBe("Waiting for SSH…");
  expect(
    Option.getOrUndefined(limaProgressMessage("Guest agent is running"))
  ).toBe("Starting guest services…");
  expect(
    Option.getOrUndefined(
      limaProgressMessage(
        "Waiting for the optional requirement: `containerd binaries to be installed`"
      )
    )
  ).toBe("Installing container tooling…");
  expect(
    Option.getOrUndefined(
      limaProgressMessage(
        "Downloading the nerdctl archive (nerdctl-full-2.3.5-linux-arm64.tar.gz)"
      )
    )
  ).toBe("Downloading container tooling…");
  expect(
    Option.getOrUndefined(
      limaProgressMessage(
        "[cloud-init] + tar Cxaf /tmp/check /mnt/lima-cidata/nerdctl-full.tgz bin/nerdctl"
      )
    )
  ).toBe("Checking container tooling…");
  expect(
    Option.getOrUndefined(
      limaProgressMessage(
        "[cloud-init] + tar Cxaf /usr/local /mnt/lima-cidata/nerdctl-full.tgz"
      )
    )
  ).toBe("Extracting container tooling…");
  expect(
    Option.getOrUndefined(
      limaProgressMessage(
        "[cloud-init] + containerd-rootless-setuptool.sh install"
      )
    )
  ).toBe("Starting container services…");
  expect(
    Option.getOrUndefined(
      limaProgressMessage("[cloud-init] + apt-get install -y uidmap fuse3")
    )
  ).toBe("Installing VM dependencies…");
  expect(
    Option.getOrUndefined(
      limaProgressMessage(
        "[cloud-init] Ign:35 http://security.ubuntu.com/ubuntu resolute-security InRelease"
      )
    )
  ).toBe("Package mirror is slow; retrying…");
  expect(
    Option.getOrUndefined(
      limaProgressMessage("[cloud-init] Fetched 30.3 MB in 1min 58s (256 kB/s)")
    )
  ).toBe("Downloaded VM dependencies (30.3 MB in 1min 58s)");
  expect(
    Option.getOrUndefined(
      limaProgressMessage("[cloud-init] Need to get 67.3 kB of archives.")
    )
  ).toBe("Downloading VM packages… 67.3 kB total");
  expect(
    Option.getOrUndefined(
      limaProgressMessage(
        "Waiting for the final requirement: `boot scripts must have finished`"
      )
    )
  ).toBe("Running boot scripts…");
  expect(
    Option.getOrUndefined(limaProgressMessage("Shutting down the SSH master"))
  ).toBe("Closing SSH connections…");
  expect(
    Option.getOrUndefined(limaProgressMessage("Shutting down the host agent"))
  ).toBe("Stopping guest services…");
});

it("ignores malformed and unrelated Lima logs", () => {
  expect(Option.isNone(decodeLimaLogLine("not json"))).toBe(true);
  expect(Option.isNone(limaProgressMessage("Forwarding TCP"))).toBe(true);
  expect(
    Option.isNone(
      limaProgressMessage("[cloud-init] Downloading application source")
    )
  ).toBe(true);
});

it("keeps actionable diagnostics while suppressing informational logs", () => {
  expect(
    Option.isNone(
      limaActionableDiagnosticLine(
        '{"level":"info","msg":"Aborting, no changes made to the instance"}'
      )
    )
  ).toBe(true);
  expect(
    Option.getOrUndefined(
      limaActionableDiagnosticLine(
        '{"level":"warning","msg":"Using a deprecated configuration"}'
      )
    )
  ).toBe("WARNING Using a deprecated configuration");
  expect(
    Option.getOrUndefined(
      limaActionableDiagnosticLine("ERRO[0001] Failed to inspect disk")
    )
  ).toBe("ERROR Failed to inspect disk");
});

it("extracts a clean failure message from Lima logfmt output", () => {
  const stderr = [
    'time="2026-07-29T18:08:18+05:30" level=warning msg="failed to detect whether running under rosetta, assuming false" error="sysctl failed"',
    'time="2026-07-29T18:08:18+05:30" level=warning msg="No instance matching dev found."',
    'time="2026-07-29T18:08:18+05:30" level=fatal msg="unmatched instances"',
  ].join("\n");

  expect(Option.getOrUndefined(limaFailureMessage(stderr))).toBe(
    "No instance matching dev found."
  );
});

it("extracts failure messages from structured and classic Lima logs", () => {
  expect(
    Option.getOrUndefined(
      limaFailureMessage(
        '{"level":"error","msg":"Failed to inspect disk","time":"now"}'
      )
    )
  ).toBe("Failed to inspect disk");
  expect(
    Option.getOrUndefined(
      limaFailureMessage("WARN[0000] Configuration is deprecated")
    )
  ).toBe("Configuration is deprecated");
});

it("maps both plain downloader output and structured logs", () => {
  expect(
    Option.getOrUndefined(
      limaProgressLine(
        "Downloading the image (ubuntu-24.04-server-cloudimg-arm64.img)"
      )
    )
  ).toBe("Downloading VM image…");
  expect(
    Option.getOrUndefined(
      limaProgressLine(
        '{"level":"info","msg":"Decompressing the image","time":"now"}'
      )
    )
  ).toBe("Preparing VM image…");
  expect(
    Option.getOrUndefined(
      limaProgressLine(
        '{"level":"info","msg":"Guest agent is running","time":"now"}'
      )
    )
  ).toBe("Starting guest services…");
  expect(Option.isNone(limaProgressLine("42.1 MiB / 250 MiB"))).toBe(true);
});

it("extracts package download activity for cumulative progress", () => {
  expect(
    Option.getOrUndefined(
      limaPackageDownloadPhase("[cloud-init] + apt-get update")
    )
  ).toBe("indexes");
  expect(
    Option.getOrUndefined(
      limaPackageDownloadPhase(
        '{"level":"info","msg":"[cloud-init] + apt-get install -y uidmap"}'
      )
    )
  ).toBe("packages");
  expect(
    Option.getOrUndefined(
      limaPackageDownloadBytes(
        "[cloud-init] Get:18 http://archive.ubuntu.com/ubuntu resolute/universe arm64 Packages [16.2 MB]"
      )
    )
  ).toBe(16_200_000);
  expect(
    Option.getOrUndefined(
      limaPackageDownloadBytes(
        '{"level":"info","msg":"[cloud-init] Get:3 http://security.ubuntu.com resolute/main Packages [358 kB]"}'
      )
    )
  ).toBe(358_000);
  expect(formatDownloadBytes(16_558_000)).toBe("16.6 MB");
  expect(formatProgressElapsed(142_000)).toBe("2m 22s");
});

it("detects package managers without assuming a guest distribution", () => {
  for (const command of [
    "[cloud-init] + dnf makecache",
    "[cloud-init] + yum -q makecache",
    "[cloud-init] + apk update",
    "[cloud-init] + pacman --noconfirm -Syu",
  ]) {
    expect(Option.getOrUndefined(limaPackageDownloadPhase(command))).toBe(
      "indexes"
    );
  }

  for (const command of [
    "[cloud-init] + dnf -y install curl",
    "[cloud-init] + yum install -y git",
    "[cloud-init] + apk add curl",
    "[cloud-init] + pacman --noconfirm -S curl",
  ]) {
    expect(Option.getOrUndefined(limaPackageDownloadPhase(command))).toBe(
      "packages"
    );
  }

  expect(
    Option.getOrUndefined(
      limaProgressMessage(
        "[cloud-init] fetch https://dl-cdn.alpinelinux.org/alpine/v3.22/main/aarch64/APKINDEX.tar.gz"
      )
    )
  ).toBe("Downloading package indexes…");
  expect(
    Option.getOrUndefined(
      limaProgressMessage(
        "[cloud-init] fetch https://dl-cdn.alpinelinux.org/alpine/v3.22/main/aarch64/curl-8.12.1-r1.apk"
      )
    )
  ).toBe("Downloading VM packages…");
  expect(
    Option.getOrUndefined(
      limaProgressMessage(
        "[cloud-init] (1/4): curl-8.12.1-1.fc42.aarch64.rpm 2.1 MB/s | 365 kB 00:00"
      )
    )
  ).toBe("Downloading VM packages…");
  expect(
    Option.getOrUndefined(
      limaProgressMessage("[cloud-init] downloading core.db...")
    )
  ).toBe("Downloading package indexes…");
  expect(
    Option.getOrUndefined(
      limaProgressMessage("[cloud-init] curl-8.12.1-1 downloading...")
    )
  ).toBe("Downloading VM packages…");
  expect(
    Option.getOrUndefined(
      limaPackageDownloadBytes(
        "[cloud-init] (1/4): curl-8.12.1-1.fc42.aarch64.rpm 2.1 MB/s | 1.5 MiB 00:01"
      )
    )
  ).toBe(1_572_864);
  expect(
    Option.isNone(
      limaPackageDownloadBytes("[cloud-init] Total 2.1 MB/s | 1.5 MiB 00:01")
    )
  ).toBe(true);
});
