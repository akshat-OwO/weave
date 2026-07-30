import path from "node:path";

import { Clock, Effect, FileSystem, Option, Schema } from "effect";

import type { Ttl } from "../schemas/ttl.schema";
import { LimaRuntime } from "../services/lima-runtime";

const VmTtlMetadata = Schema.Struct({
  expiresAt: Schema.Number,
});

const VmTtlMetadataJson = Schema.fromJsonString(VmTtlMetadata);
const metadataFileName = ".weave-ttl.json";

export const vmTtlMetadataPath = (limaHome: string, name: string): string =>
  path.join(limaHome, name, metadataFileName);

export const writeVmTtl = Effect.fn("weave/lib/vmTtl/writeVmTtl")(
  function* writeVmTtlHandler(
    limaHome: string,
    name: string,
    expiresAt: number
  ) {
    const fs = yield* FileSystem.FileSystem;
    const contents = Schema.encodeSync(VmTtlMetadataJson)({ expiresAt });

    yield* fs.writeFileString(vmTtlMetadataPath(limaHome, name), contents);
  }
);

export const scheduleVmTtlAt = Effect.fn("weave/lib/vmTtl/scheduleVmTtlAt")(
  function* scheduleVmTtlAtHandler(
    limaHome: string,
    name: string,
    expiresAt: number
  ) {
    const lima = yield* LimaRuntime;
    const currentTimeMillis = yield* Clock.currentTimeMillis;
    const remainingSeconds = Math.max(
      1,
      Math.ceil((expiresAt - currentTimeMillis) / 1000)
    );

    yield* lima.run([
      "shell",
      name,
      "--",
      "sudo",
      "systemd-run",
      "--quiet",
      "--unit=weave-ttl",
      `--on-active=${remainingSeconds}s`,
      "--timer-property=AccuracySec=1s",
      "--collect",
      "systemctl",
      "poweroff",
    ]);
    yield* writeVmTtl(limaHome, name, expiresAt);
  }
);

export const scheduleVmTtl = Effect.fn("weave/lib/vmTtl/scheduleVmTtl")(
  function* scheduleVmTtlHandler(limaHome: string, name: string, ttl: Ttl) {
    const expiresAt = (yield* Clock.currentTimeMillis) + ttl.seconds * 1000;

    yield* scheduleVmTtlAt(limaHome, name, expiresAt);
  }
);

export const readVmTtl = Effect.fn("weave/lib/vmTtl/readVmTtl")(
  function* readVmTtlHandler(limaHome: string, name: string) {
    const fs = yield* FileSystem.FileSystem;
    const metadataPath = vmTtlMetadataPath(limaHome, name);
    const exists = yield* fs.exists(metadataPath);

    if (!exists) {
      return Option.none<number>();
    }

    return yield* fs.readFileString(metadataPath).pipe(
      Effect.map((contents) =>
        Schema.decodeUnknownOption(VmTtlMetadataJson)(contents).pipe(
          Option.map(({ expiresAt }) => expiresAt)
        )
      ),
      Effect.catch(() => Effect.succeed(Option.none<number>()))
    );
  }
);

const durationUnits = [
  { label: "d", seconds: 86_400 },
  { label: "h", seconds: 3600 },
  { label: "m", seconds: 60 },
  { label: "s", seconds: 1 },
] as const;

export const formatRemainingTtl = (
  expiresAt: number,
  currentTimeMillis: number
): string => {
  let remainingSeconds = Math.ceil((expiresAt - currentTimeMillis) / 1000);
  if (remainingSeconds <= 0) {
    return "expired";
  }

  const parts: string[] = [];
  for (const unit of durationUnits) {
    const value = Math.floor(remainingSeconds / unit.seconds);
    if (value > 0) {
      parts.push(`${value}${unit.label}`);
      remainingSeconds %= unit.seconds;
    }
  }

  return parts.slice(0, 2).join(" ");
};
