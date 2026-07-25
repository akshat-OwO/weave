import { Schema } from "effect";

export class QemuNotFoundError extends Schema.TaggedErrorClass<QemuNotFoundError>()(
  "QemuNotFoundError",
  { executable: Schema.NonEmptyString }
) {
  override get message() {
    return `QEMU is required for isolated VMs on Windows. Install QEMU and ensure "${this.executable}" is available on PATH.`;
  }
}
