import { Schema } from "effect";

export class InvalidVmTemplateError extends Schema.TaggedErrorClass<InvalidVmTemplateError>()(
  "InvalidVmTemplateError",
  {
    reason: Schema.String,
    template: Schema.String,
  }
) {
  override get message() {
    return `Invalid VM template "${this.template}": ${this.reason}`;
  }
}
