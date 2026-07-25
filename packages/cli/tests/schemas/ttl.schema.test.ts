import { expect, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";
import { describe } from "vitest";

import { Ttl } from "../../src/schemas/ttl.schema";

describe("Ttl", () => {
  it.effect("decodes and encodes every supported TTL unit", () =>
    Effect.gen(function* ttlUnitsTest() {
      const cases = [
        ["10s", 10],
        ["10m", 600],
        ["10h", 36_000],
        ["2d", 172_800],
      ] as const;

      for (const [value, seconds] of cases) {
        const ttl = yield* Schema.decodeUnknownEffect(Ttl)(value);
        expect(ttl).toEqual({ seconds, value });
        expect(yield* Schema.encodeEffect(Ttl)(ttl)).toBe(value);
      }
    })
  );

  it("rejects zero, negative, fractional, missing, and unknown TTL units", () => {
    for (const value of ["0s", "-1m", "1.5h", "10", "1w", "", " 10m"]) {
      expect(Schema.decodeUnknownOption(Ttl)(value)).toEqual(Option.none());
    }
  });

  it("rejects durations whose seconds overflow the integer schema", () => {
    expect(
      Schema.decodeUnknownOption(Ttl)(`${Number.MAX_SAFE_INTEGER}d`)
    ).toEqual(Option.none());
  });
});
