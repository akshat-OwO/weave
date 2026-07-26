import { Schema } from "effect";

import { VmName } from "./vm-name.schema";

export const VmBackend = Schema.Union([
  Schema.Literal("native"),
  Schema.Literal("lima"),
]);

export type VmBackend = typeof VmBackend.Type;

export const VmStatus = Schema.Union([
  Schema.Literal("Running"),
  Schema.Literal("Stopped"),
]);

export type VmStatus = typeof VmStatus.Type;

const VmNetwork = Schema.Struct({
  guestIp: Schema.NonEmptyString,
  hostIp: Schema.NonEmptyString,
  macAddress: Schema.NonEmptyString,
  slot: Schema.Int,
  tapDevice: Schema.NonEmptyString,
});

export const VmRecord = Schema.Struct({
  backend: VmBackend,
  bootId: Schema.NullOr(Schema.NonEmptyString),
  cpuCount: Schema.Int,
  createdAt: Schema.Number,
  expiresAt: Schema.Number,
  memoryMiB: Schema.Int,
  name: VmName,
  network: VmNetwork,
  status: VmStatus,
  template: Schema.NullOr(Schema.NonEmptyString),
  version: Schema.Literal(1),
});

export type VmRecord = typeof VmRecord.Type;

export const VmRecordJson = Schema.fromJsonString(VmRecord);
