import { Schema } from "effect";

import { VmName } from "../vm-name.schema";

export class VmNotRunningError extends Schema.TaggedErrorClass<VmNotRunningError>()(
  "VmNotRunningError",
  { name: VmName }
) {
  override get message() {
    return `VM "${this.name}" is not running.`;
  }
}
