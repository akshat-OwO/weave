import { Schema } from "effect";

export class VmCapacityError extends Schema.TaggedErrorClass<VmCapacityError>()(
  "VmCapacityError",
  {
    availableCpuCount: Schema.Int,
    availableMemoryMiB: Schema.Int,
    requestedCpuCount: Schema.Int,
    requestedMemoryMiB: Schema.Int,
  }
) {
  override get message() {
    return `Insufficient Firecracker host capacity: requested ${this.requestedCpuCount} vCPU and ${this.requestedMemoryMiB} MiB, but ${this.availableCpuCount} vCPU and ${this.availableMemoryMiB} MiB are available`;
  }
}
