import { Schema } from "effect";

import { PortNumber } from "../port-mapping.schema";
import { VmName } from "../vm-name.schema";

export class PortNotPublishedError extends Schema.TaggedErrorClass<PortNotPublishedError>()(
  "PortNotPublishedError",
  {
    hostPort: PortNumber,
    name: VmName,
  }
) {
  override get message() {
    return `Host port ${this.hostPort} is not published for VM "${this.name}".`;
  }
}
