import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";

import {
  limaNetworkArguments,
  vmNetworkMetadataPath,
} from "../../src/lib/vm-network";
import { makeCliHarness } from "../helpers/cli";

const networkPath = vmNetworkMetadataPath("/test/weave/lima-home", "dev");
const networkFileWrites = (
  fileWrites: readonly { readonly contents: string; readonly path: string }[]
) =>
  fileWrites.filter(
    ({ path }) => path === networkPath || path.includes("/.weave-network.")
  );

describe("port", () => {
  it.effect("adds a mapping to a stopped VM", () =>
    Effect.gen(function* addStoppedPortTest() {
      const harness = makeCliHarness({
        existingVm: true,
        limaOutputs: [{ stderr: "", stdout: "Stopped\n" }],
      });

      yield* harness.run(["port", "add", "dev", "8080:3000"]);

      expect(harness.calls).toEqual([
        {
          args: ["list", "dev", "--format={{.Status}}"],
          captured: true,
        },
        {
          acceptableExitCodes: undefined,
          args: [
            "edit",
            "--tty=false",
            ...limaNetworkArguments([{ guestPort: 3000, hostPort: 8080 }]),
            "dev",
          ],
          progress: {
            failureMessage: "Failed to update port mappings for dev",
            initialMessage: "Updating port mappings for dev…",
          },
        },
      ]);
      const writes = networkFileWrites(harness.fileWrites);
      expect(writes).toHaveLength(1);
      expect(JSON.parse(writes[0]?.contents ?? "{}")).toEqual({
        ports: [{ guestPort: 3000, hostPort: 8080 }],
        version: 1,
      });
      expect(harness.stdout).toEqual([
        "✔ Published 127.0.0.1:8080 → dev:3000 in 0s",
      ]);
    })
  );

  it.effect("restarts a running VM and preserves its absolute TTL", () =>
    Effect.gen(function* addRunningPortTest() {
      const harness = makeCliHarness({
        existingVm: true,
        limaOutputs: [{ stderr: "", stdout: "Running\n" }],
        ttlExpiresAtByVm: { dev: 600_000 },
      });

      yield* harness.run(["port", "add", "dev", "8080:3000"]);

      expect(harness.calls.map(({ args }) => args[0])).toEqual([
        "list",
        "stop",
        "edit",
        "start",
        "shell",
      ]);
      expect(harness.calls[1]?.args).toEqual(["stop", "--tty=false", "dev"]);
      expect(harness.calls[2]?.args).toEqual([
        "edit",
        "--tty=false",
        ...limaNetworkArguments([{ guestPort: 3000, hostPort: 8080 }]),
        "dev",
      ]);
      expect(harness.calls[4]?.args).toContain("--on-active=600s");
      expect(harness.fileWrites).toContainEqual({
        contents: '{"expiresAt":600000}',
        path: "/test/weave/lima-home/dev/.weave-ttl.json",
      });
      expect(
        JSON.parse(
          networkFileWrites(harness.fileWrites).at(-1)?.contents ?? "{}"
        )
      ).toEqual({
        ports: [{ guestPort: 3000, hostPort: 8080 }],
        version: 1,
      });
    })
  );

  it.effect("adds multiple mappings and rejects duplicate parent ports", () =>
    Effect.gen(function* multiplePortsTest() {
      const harness = makeCliHarness({
        existingVm: true,
        limaOutputs: [
          { stderr: "", stdout: "Stopped\n" },
          { stderr: "", stdout: "Stopped\n" },
        ],
      });

      yield* harness.run(["port", "add", "dev", "8080:3000"]);
      yield* harness.run(["port", "add", "dev", "8081:3001"]);
      const error = yield* Effect.flip(
        harness.run(["port", "add", "dev", "8080:4000"])
      );

      expect(error).toMatchObject({
        _tag: "PortAlreadyPublishedError",
        hostPort: 8080,
        name: "dev",
      });
      expect(
        JSON.parse(
          networkFileWrites(harness.fileWrites).at(-1)?.contents ?? "{}"
        )
      ).toEqual({
        ports: [
          { guestPort: 3000, hostPort: 8080 },
          { guestPort: 3001, hostPort: 8081 },
        ],
        version: 1,
      });
    })
  );

  it.effect("removes a mapping without changing the other mappings", () =>
    Effect.gen(function* removePortTest() {
      const harness = makeCliHarness({
        existingVm: true,
        fileContents: {
          [networkPath]: JSON.stringify({
            ports: [
              { guestPort: 3000, hostPort: 8080 },
              { guestPort: 3001, hostPort: 8081 },
            ],
            version: 1,
          }),
        },
        limaOutputs: [{ stderr: "", stdout: "Stopped\n" }],
      });

      yield* harness.run(["port", "remove", "dev", "8080"]);

      expect(harness.calls[1]?.args).toEqual([
        "edit",
        "--tty=false",
        ...limaNetworkArguments([{ guestPort: 3001, hostPort: 8081 }]),
        "dev",
      ]);
      expect(
        JSON.parse(networkFileWrites(harness.fileWrites)[0]?.contents ?? "{}")
      ).toEqual({
        ports: [{ guestPort: 3001, hostPort: 8081 }],
        version: 1,
      });
    })
  );

  it.effect("lists mappings from persistent metadata", () =>
    Effect.gen(function* listPortsTest() {
      const harness = makeCliHarness({
        existingVm: true,
        fileContents: {
          [networkPath]: JSON.stringify({
            ports: [
              { guestPort: 3000, hostPort: 8080 },
              { guestPort: 3001, hostPort: 8081 },
            ],
            version: 1,
          }),
        },
      });

      yield* harness.run(["port", "ls", "dev"]);

      expect(harness.stdout).toEqual([
        [
          "PARENT\tGUEST\tPROTOCOL",
          "127.0.0.1:8080\t3000\ttcp",
          "127.0.0.1:8081\t3001\ttcp",
        ].join("\n"),
      ]);
    })
  );

  it.effect("rejects invalid mappings and unsupported VM states", () =>
    Effect.gen(function* invalidPortTest() {
      const invalidHarness = makeCliHarness({ existingVm: true });
      const invalidError = yield* Effect.flip(
        invalidHarness.run(["port", "add", "dev", "70000:3000"])
      );

      expect(invalidError).toMatchObject({ _tag: "ShowHelp" });
      expect(invalidHarness.calls).toEqual([]);

      const sshPortError = yield* Effect.flip(
        invalidHarness.run(["port", "add", "dev", "8080:22"])
      );
      expect(sshPortError).toMatchObject({ _tag: "ShowHelp" });
      expect(invalidHarness.calls).toEqual([]);

      const brokenHarness = makeCliHarness({
        existingVm: true,
        limaOutputs: [{ stderr: "", stdout: "Broken\n" }],
      });
      const brokenError = yield* Effect.flip(
        brokenHarness.run(["port", "add", "dev", "8080:3000"])
      );

      expect(brokenError).toMatchObject({
        _tag: "VmLifecycleStateError",
        name: "dev",
        status: "Broken",
      });
      expect(networkFileWrites(brokenHarness.fileWrites)).toEqual([]);
    })
  );
});
