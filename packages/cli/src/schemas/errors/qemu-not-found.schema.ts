import { Schema } from "effect";

export class QemuNotFoundError extends Schema.TaggedErrorClass<QemuNotFoundError>()(
  "QemuNotFoundError",
  { executable: Schema.NonEmptyString }
) {
  override get message() {
    return `QEMU is required for isolated VMs on Windows, but "${this.executable}" was not found. Rerun the PowerShell installer to install and configure QEMU automatically.`;
  }
}
