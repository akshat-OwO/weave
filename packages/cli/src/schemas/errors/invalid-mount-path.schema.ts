import { Schema } from "effect";

export class InvalidMountPathError extends Schema.TaggedErrorClass<InvalidMountPathError>()(
  "InvalidMountPathError",
  {
    path: Schema.String,
    reason: Schema.String,
  }
) {
  override get message() {
    return `Invalid mount path "${this.path}": ${this.reason}.`;
  }
}
