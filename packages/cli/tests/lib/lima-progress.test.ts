import { expect, it } from "@effect/vitest";
import { Option } from "effect";

import {
  decodeLimaLogLine,
  formatLimaLog,
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
  ).toBe("Downloading Ubuntu image…");
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
});

it("maps both plain downloader output and structured logs", () => {
  expect(
    Option.getOrUndefined(
      limaProgressLine(
        "Downloading the image (ubuntu-24.04-server-cloudimg-arm64.img)"
      )
    )
  ).toBe("Downloading Ubuntu image…");
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
