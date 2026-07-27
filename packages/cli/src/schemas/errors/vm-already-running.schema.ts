import { Schema } from "effect";

import { VmName } from "../vm-name.schema";

export class VmAlreadyRunningError extends Schema.TaggedErrorClass<VmAlreadyRunningError>()(
  "VmAlreadyRunningError",
  { name: VmName }
) {
  override get message() {
    return `VM "${this.name}" is already running.`;
  }
}
