import { Schema } from "effect";

export const VmName = Schema.String.check(
  Schema.isPattern(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/u, {
    message:
      "VM name must start with a letter or number and contain only letters, numbers, dots, underscores, or hyphens",
  }),
  Schema.isMaxLength(64, {
    message: "VM name must be at most 64 characters",
  })
);

export type VmName = typeof VmName.Type;
