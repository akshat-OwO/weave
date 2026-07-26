import { Schema } from "effect";

export class RuntimeArtifactError extends Schema.TaggedErrorClass<RuntimeArtifactError>()(
  "RuntimeArtifactError",
  {
    artifact: Schema.NonEmptyString,
    reason: Schema.NonEmptyString,
  }
) {
  override get message() {
    return `Failed to prepare ${this.artifact}: ${this.reason}`;
  }
}
