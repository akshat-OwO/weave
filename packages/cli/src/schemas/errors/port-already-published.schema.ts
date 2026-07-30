import { Schema } from "effect";

import { PortNumber } from "../port-mapping.schema";
import { VmName } from "../vm-name.schema";

export class PortAlreadyPublishedError extends Schema.TaggedErrorClass<PortAlreadyPublishedError>()(
  "PortAlreadyPublishedError",
  {
    hostPort: PortNumber,
    name: VmName,
  }
) {
  override get message() {
    return `Host port ${this.hostPort} is already published for VM "${this.name}".`;
  }
}
