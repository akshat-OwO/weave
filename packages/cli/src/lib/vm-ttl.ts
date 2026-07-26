import path from "node:path";

import { Effect, FileSystem, Option, Schema } from "effect";

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
