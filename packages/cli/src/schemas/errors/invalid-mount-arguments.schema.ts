import { Schema } from "effect";

export class InvalidMountArgumentsError extends Schema.TaggedErrorClass<InvalidMountArgumentsError>()(
  "InvalidMountArgumentsError",
  {
    mountEnabled: Schema.Boolean,
    paths: Schema.Array(Schema.String),
  }
) {
  override get message() {
    return this.mountEnabled
      ? 'The "--mount" flag requires at least one host directory.'
      : `Host directories must follow the "--mount" flag: ${this.paths.join(" ")}`;
  }
}
