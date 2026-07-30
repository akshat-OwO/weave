import { Schema, SchemaGetter } from "effect";

export const PortNumber = Schema.Int.check(
  Schema.isBetween(
    { maximum: 65_535, minimum: 1 },
    {
      message: "Port must be between 1 and 65535",
    }
  )
);

const ApplicationGuestPort = PortNumber.check(
  Schema.makeFilter(
    (port) =>
      port === 22 ? "Guest port 22 is reserved for VM access" : undefined,
    { message: "Guest port 22 is reserved for VM access" }
  )
);

export const PortMapping = Schema.Struct({
  guestPort: ApplicationGuestPort,
  hostPort: PortNumber,
});

const PortMappingText = Schema.String.check(
  Schema.isPattern(/^[1-9]\d{0,4}:[1-9]\d{0,4}$/u, {
    message: "Port mapping must use HOST_PORT:GUEST_PORT",
  })
);

export const PortMappingArgument = PortMappingText.pipe(
  Schema.decodeTo(PortMapping, {
    decode: SchemaGetter.transform((value) => {
      const [hostPort, guestPort] = value.split(":");

      return {
        guestPort: Number(guestPort),
        hostPort: Number(hostPort),
      };
    }),
    encode: SchemaGetter.transform(
      ({ guestPort, hostPort }) => `${hostPort}:${guestPort}`
    ),
  })
);

export type PortMapping = typeof PortMapping.Type;
