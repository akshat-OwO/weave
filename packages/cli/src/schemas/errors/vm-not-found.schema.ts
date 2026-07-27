import { Schema } from "effect";

import { VmName } from "../vm-name.schema";

export class VmNotFoundError extends Schema.TaggedErrorClass<VmNotFoundError>()(
  "VmNotFoundError",
  { name: VmName }
) {
  override get message() {
    return `VM "${this.name}" does not exist. Create it with "weave create ${this.name}".`;
  }
}
