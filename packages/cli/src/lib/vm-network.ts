import path from "node:path";

import { Effect, FileSystem, Option, Schema } from "effect";

import type { PortMapping } from "../schemas/port-mapping.schema";
import { PortMapping as PortMappingSchema } from "../schemas/port-mapping.schema";

const VmNetworkMetadata = Schema.Struct({
  ports: Schema.Array(PortMappingSchema),
  version: Schema.Literal(1),
});

const VmNetworkMetadataJson = Schema.fromJsonString(VmNetworkMetadata);
const metadataFileName = ".weave-network.json";

const denyAllPortForwardRule = {
  guestIP: "0.0.0.0",
  guestIPMustBeZero: false,
  guestPortRange: [1, 65_535],
  ignore: true,
  proto: "any",
} as const;

export const vmNetworkMetadataPath = (limaHome: string, name: string): string =>
  path.join(limaHome, name, metadataFileName);

export const limaPortForwardExpression = (
  ports: readonly PortMapping[]
): string => {
  const rules = [
    ...ports.map(({ guestPort, hostPort }) => ({
      guestIP: "127.0.0.1",
      guestPort,
      hostIP: "127.0.0.1",
      hostPort,
      proto: "tcp",
      static: true,
    })),
    denyAllPortForwardRule,
  ];

  return `.portForwards = ${JSON.stringify(rules)}`;
};

export const limaNetworkArguments = (
  ports: readonly PortMapping[]
): readonly string[] => [
  "--set=.networks = []",
  `--set=${limaPortForwardExpression(ports)}`,
];

export const readVmNetwork = Effect.fn("weave/lib/vmNetwork/readVmNetwork")(
  function* readVmNetworkHandler(limaHome: string, name: string) {
    const fs = yield* FileSystem.FileSystem;
    const metadataPath = vmNetworkMetadataPath(limaHome, name);
    const exists = yield* fs.exists(metadataPath);

    if (!exists) {
      return [] as readonly PortMapping[];
    }

    return yield* fs.readFileString(metadataPath).pipe(
      Effect.map((contents) =>
        Schema.decodeUnknownOption(VmNetworkMetadataJson)(contents).pipe(
          Option.match({
            onNone: () => [] as readonly PortMapping[],
            onSome: ({ ports }) => ports,
          })
        )
      ),
      Effect.catch(() => Effect.succeed([] as readonly PortMapping[]))
    );
  }
);

export const writeVmNetwork = Effect.fn("weave/lib/vmNetwork/writeVmNetwork")(
  function* writeVmNetworkHandler(
    limaHome: string,
    name: string,
    ports: readonly PortMapping[]
  ) {
    const fs = yield* FileSystem.FileSystem;
    const instanceDirectory = path.join(limaHome, name);
    const temporaryPath = yield* fs.makeTempFile({
      directory: instanceDirectory,
      prefix: ".weave-network.",
      suffix: ".tmp",
    });
    const temporaryDirectory = path.dirname(temporaryPath);

    yield* Effect.gen(function* writeVmNetworkFile() {
      yield* fs.writeFileString(
        temporaryPath,
        Schema.encodeSync(VmNetworkMetadataJson)({
          ports: [...ports],
          version: 1,
        })
      );
      yield* fs.rename(temporaryPath, vmNetworkMetadataPath(limaHome, name));
    }).pipe(
      Effect.ensuring(
        fs
          .remove(temporaryDirectory, { force: true, recursive: true })
          .pipe(Effect.ignore)
      )
    );
  }
);
