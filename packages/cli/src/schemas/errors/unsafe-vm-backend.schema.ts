import { Schema } from "effect";

import { VmName } from "../vm-name.schema";

export class UnsafeVmBackendError extends Schema.TaggedErrorClass<UnsafeVmBackendError>()(
  "UnsafeVmBackendError",
  {
    backend: Schema.NonEmptyString,
    name: VmName,
  }
) {
  override get message() {
    return `VM "${this.name}" uses the unsafe "${this.backend}" backend, which can access Windows host drives. Delete and recreate the VM to use QEMU isolation.`;
  }
}
