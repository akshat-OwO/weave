import { Schema } from "effect";

import { VmName } from "../vm-name.schema";

export class VmAlreadyExistsError extends Schema.TaggedErrorClass<VmAlreadyExistsError>()(
  "VmAlreadyExistsError",
  { name: VmName }
) {
  override get message() {
    return `VM "${this.name}" already exists. Use a different name.`;
  }
}
