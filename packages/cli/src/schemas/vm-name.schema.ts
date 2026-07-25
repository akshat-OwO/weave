import { Schema } from "effect";

export const VmName = Schema.String.check(
  Schema.isPattern(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/u, {
    message:
      "VM name must start with a letter or number and contain only letters, numbers, dots, underscores, or hyphens",
  })
);

export type VmName = typeof VmName.Type;
