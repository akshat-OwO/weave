import { Schema } from "effect";

import { VmName } from "../vm-name.schema";

export class TemplateOnExistingVmError extends Schema.TaggedErrorClass<TemplateOnExistingVmError>()(
  "TemplateOnExistingVmError",
  { name: VmName }
) {
  override get message() {
    return `VM "${this.name}" already exists. Templates can only be selected when creating a new VM.`;
  }
}
