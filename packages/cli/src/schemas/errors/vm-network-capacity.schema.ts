import { Schema } from "effect";

export class VmNetworkCapacityError extends Schema.TaggedErrorClass<VmNetworkCapacityError>()(
  "VmNetworkCapacityError",
  { maximumVmCount: Schema.Int }
) {
  override get message() {
    return `All ${this.maximumVmCount} Firecracker VM network slots are allocated`;
  }
}
