import { Schema, SchemaGetter } from "effect";

const TtlText = Schema.String.check(
  Schema.isPattern(/^[1-9]\d*[smhd]$/u, {
    message: "TTL must be a positive duration such as 10s, 10m, 10h, or 1d",
  })
);

const PositiveSeconds = Schema.Int.check(
  Schema.isGreaterThan(0, { message: "TTL is too large" })
);

const secondsFromTtl = (value: string): number => {
  const amount = Number(value.slice(0, -1));
  const unit = value.at(-1);

  if (unit === "m") {
    return amount * 60;
  }
  if (unit === "h") {
    return amount * 60 * 60;
  }
  if (unit === "d") {
    return amount * 24 * 60 * 60;
  }
  return amount;
};

export const Ttl = TtlText.pipe(
  Schema.decodeTo(
    Schema.Struct({
      seconds: PositiveSeconds,
      value: TtlText,
    }),
    {
      decode: SchemaGetter.transform((value) => ({
        seconds: secondsFromTtl(value),
        value,
      })),
      encode: SchemaGetter.transform(({ value }) => value),
    }
  )
);

export type Ttl = typeof Ttl.Type;
