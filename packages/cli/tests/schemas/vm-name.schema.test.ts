import { expect, it } from "@effect/vitest";
import { Option, Schema } from "effect";
import { describe } from "vitest";

import { VmName } from "../../src/schemas/vm-name.schema";

describe("VmName", () => {
  it("accepts all supported name characters", () => {
    for (const name of ["dev", "Dev01", "dev.vm_1-test"]) {
      expect(Schema.decodeUnknownOption(VmName)(name)).toEqual(
        Option.some(name)
      );
    }
  });

  it("rejects unsafe and malformed names", () => {
    for (const name of ["", "-dev", "_dev", ".dev", "../dev", "dev vm"]) {
      expect(Schema.decodeUnknownOption(VmName)(name)).toEqual(Option.none());
    }
  });

  it("allows names that share the internal base prefix", () => {
    expect(Schema.decodeUnknownOption(VmName)("wvbase-user")).toEqual(
      Option.some("wvbase-user")
    );
  });
});
