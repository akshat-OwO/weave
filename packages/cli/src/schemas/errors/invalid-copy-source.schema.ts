import { Schema } from "effect";

export class InvalidCopySourceError extends Schema.TaggedErrorClass<InvalidCopySourceError>()(
  "InvalidCopySourceError",
  {
    path: Schema.String,
    reason: Schema.String,
  }
) {
  override get message() {
    return `Invalid copy source "${this.path}": ${this.reason}.`;
  }
}
