import { Schema } from "effect";

import { VmName } from "../vm-name.schema";

export class UnsafeVmMountsError extends Schema.TaggedErrorClass<UnsafeVmMountsError>()(
  "UnsafeVmMountsError",
  { name: VmName }
) {
  override get message() {
    return `VM "${this.name}" has host-directory mounts configured. Run "weave create ${this.name}" to remove the mounts and start it safely.`;
  }
}
