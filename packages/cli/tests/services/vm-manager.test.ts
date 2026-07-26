import { expect, it } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";
import { describe } from "vitest";

import type { VmRecord } from "../../src/schemas/vm-record.schema";
import { FirecrackerArtifacts } from "../../src/services/firecracker-artifacts";
import type { FirecrackerArtifactPaths } from "../../src/services/firecracker-artifacts";
import { FirecrackerHost } from "../../src/services/firecracker-host";
import type { PreparedFirecrackerHost } from "../../src/services/firecracker-host";
import { VmManager, VmManagerLive } from "../../src/services/vm-manager";
import type { VmManagerService } from "../../src/services/vm-manager";
import { VmState } from "../../src/services/vm-state";
import type { VmStateService } from "../../src/services/vm-state";

const artifactPaths: FirecrackerArtifactPaths = {
  archive: "/artifacts/firecracker.tgz",
  firecracker: "/artifacts/firecracker",
  jailer: "/artifacts/jailer",
  kernel: "/artifacts/vmlinux",
  rootfsSquashfs: "/artifacts/rootfs.squashfs",
  sshPrivateKey: "/artifacts/id_ed25519",
  sshPublicKey: "/artifacts/id_ed25519.pub",
};
const defaultCapacity = { cpuCount: 8, memoryMiB: 16_384 };

const makeManager = (
  initialRecords: readonly VmRecord[] = [],
  capacity = defaultCapacity
) => {
  const records = new Map(
    initialRecords.map((record) => [record.name, record])
  );
  const runCalls: string[][] = [];
  const host: PreparedFirecrackerHost = {
    backend: "native",
    capacity,
    capture: () => Effect.succeed(""),
    paths: {
      firecracker: artifactPaths.firecracker,
      jailer: artifactPaths.jailer,
      kernel: artifactPaths.kernel,
      root: "/weave/firecracker",
      rootfsSquashfs: artifactPaths.rootfsSquashfs,
      sshPrivateKey: artifactPaths.sshPrivateKey,
      sshPublicKey: artifactPaths.sshPublicKey,
    },
    run: (args) =>
      Effect.sync(() => {
        runCalls.push([...args]);
      }),
    status: () => Effect.succeed(0),
  };
  const state: VmStateService = {
    get: (name) => Effect.succeed(Option.fromNullishOr(records.get(name))),
    list: () => Effect.succeed([...records.values()]),
    remove: (name) =>
      Effect.sync(() => {
        records.delete(name);
      }),
    withLock: (effect) => effect,
    write: (record) =>
      Effect.sync(() => {
        records.set(record.name, record);
      }),
  };
  const dependencies = Layer.mergeAll(
    Layer.succeed(FirecrackerArtifacts, {
      ensure: () => Effect.succeed(artifactPaths),
    }),
    Layer.succeed(FirecrackerHost, {
      check: () => Effect.succeed("native"),
      prepare: (_artifacts, backend) =>
        backend === undefined || backend === host.backend
          ? Effect.succeed(host)
          : Effect.die("Unexpected backend"),
    }),
    Layer.succeed(VmState, state)
  );
  const layer = VmManagerLive.pipe(Layer.provide(dependencies));

  return {
    records,
    run: <A, E>(effect: Effect.Effect<A, E, VmManagerService>) =>
      Effect.scoped(effect.pipe(Effect.provide(layer))),
    runCalls,
  };
};

const request = {
  cpuCount: 2,
  memoryMiB: 2048,
  name: "dev",
  ttl: { seconds: 600, value: "10m" },
} as const;

const existingRecord = {
  backend: "native",
  bootId: "dev-old",
  cpuCount: 2,
  createdAt: -1000,
  expiresAt: -1,
  memoryMiB: 2048,
  name: "dev",
  network: {
    guestIp: "172.30.2.2",
    hostIp: "172.30.2.1",
    macAddress: "06:00:AC:1E:02:02",
    slot: 2,
    tapDevice: "wv02",
  },
  status: "Stopped",
  template: "node",
  version: 1,
} as const satisfies VmRecord;

describe("VmManager", () => {
  it.effect("creates a Firecracker record and starts the jailer", () =>
    Effect.gen(function* createTest() {
      const harness = makeManager();
      const action = yield* harness.run(
        Effect.gen(function* createProgram() {
          const manager = yield* VmManager;
          return yield* manager.create(request);
        })
      );

      expect(action).toBe("Created");
      expect(harness.records.get("dev")).toMatchObject({
        backend: "native",
        cpuCount: 2,
        expiresAt: 600_000,
        memoryMiB: 2048,
        network: {
          guestIp: "172.30.2.2",
          hostIp: "172.30.2.1",
          slot: 2,
          tapDevice: "wv02",
        },
        status: "Running",
      });
      expect(
        harness.runCalls.some((args) => args.includes("--exec-file"))
      ).toBe(true);
      expect(
        harness.runCalls.some(
          (args) =>
            args.includes("systemd-run") && args.includes("--on-active=600s")
        )
      ).toBe(true);
    })
  );

  it.effect("restarts with new resources but preserves disk identity", () =>
    Effect.gen(function* restartTest() {
      const harness = makeManager([existingRecord]);
      const action = yield* harness.run(
        Effect.gen(function* restartProgram() {
          const manager = yield* VmManager;
          return yield* manager.create({
            ...request,
            cpuCount: 4,
            memoryMiB: 4096,
          });
        })
      );

      expect(action).toBe("Started");
      expect(harness.records.get("dev")).toMatchObject({
        cpuCount: 4,
        createdAt: -1000,
        memoryMiB: 4096,
        network: existingRecord.network,
        template: "node",
      });
    })
  );

  it.effect("rejects creates that exceed aggregate host capacity", () =>
    Effect.gen(function* capacityTest() {
      const other = {
        ...existingRecord,
        bootId: "build-running",
        cpuCount: 3,
        expiresAt: 60_000,
        memoryMiB: 3072,
        name: "build",
        status: "Running",
      } as const satisfies VmRecord;
      const harness = makeManager([other], {
        cpuCount: 4,
        memoryMiB: 4096,
      });
      const error = yield* harness.run(
        Effect.gen(function* capacityProgram() {
          const manager = yield* VmManager;
          return yield* Effect.flip(manager.create(request));
        })
      );

      expect(error).toMatchObject({
        _tag: "VmCapacityError",
        availableCpuCount: 1,
        availableMemoryMiB: 768,
      });
      expect(harness.records.has("dev")).toBe(false);
    })
  );

  it.effect("rejects custom Lima YAML templates", () =>
    Effect.gen(function* templateTest() {
      const harness = makeManager();
      const error = yield* harness.run(
        Effect.gen(function* templateProgram() {
          const manager = yield* VmManager;
          return yield* Effect.flip(
            manager.create({
              ...request,
              template: "./custom.yaml",
            })
          );
        })
      );

      expect(error).toMatchObject({
        _tag: "InvalidVmTemplateError",
        template: "./custom.yaml",
      });
    })
  );

  it.effect("reports an expired running record as stopped", () =>
    Effect.gen(function* expiredTest() {
      const harness = makeManager([
        {
          ...existingRecord,
          expiresAt: -1,
          status: "Running",
        },
      ]);
      const items = yield* harness.run(
        Effect.gen(function* listProgram() {
          const manager = yield* VmManager;
          return yield* manager.list();
        })
      );

      expect(items[0]?.status).toBe("Stopped");
    })
  );

  it.effect("preserves spaces and quotes in remote shell commands", () =>
    Effect.gen(function* shellTest() {
      const harness = makeManager([
        {
          ...existingRecord,
          expiresAt: 60_000,
          status: "Running",
        },
      ]);
      yield* harness.run(
        Effect.gen(function* shellProgram() {
          const manager = yield* VmManager;
          yield* manager.shell("dev", `printf '%s\\n' "$HOME's"`);
        })
      );

      expect(harness.runCalls.at(-1)?.at(-1)).toBe(
        `sh -lc 'printf '"'"'%s\\n'"'"' "$HOME'"'"'s"'`
      );
    })
  );
});
