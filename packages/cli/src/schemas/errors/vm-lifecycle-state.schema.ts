import { Schema } from "effect";

import { VmName } from "../vm-name.schema";

export class VmLifecycleStateError extends Schema.TaggedErrorClass<VmLifecycleStateError>()(
  "VmLifecycleStateError",
  {
    name: VmName,
    status: Schema.String,
  }
) {
  override get message() {
    const status = this.status.length > 0 ? this.status : "Unknown";

    return `VM "${this.name}" cannot be started while its status is "${status}". Run "weave ls" for details, then repair or recreate the VM.`;
  }
}
