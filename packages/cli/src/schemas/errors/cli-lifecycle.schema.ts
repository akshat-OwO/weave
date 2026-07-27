import { Schema } from "effect";

export const CliLifecyclePhase = Schema.Literals([
  "release-check",
  "download",
  "replacement",
  "removal",
  "installation-path",
]);

export type CliLifecyclePhase = typeof CliLifecyclePhase.Type;

export class CliLifecycleError extends Schema.TaggedErrorClass<CliLifecycleError>()(
  "CliLifecycleError",
  {
    detail: Schema.NonEmptyString,
    phase: CliLifecyclePhase,
    recovery: Schema.NonEmptyString,
  }
) {
  override get message() {
    return `${this.phase}: ${this.detail}`;
  }
}
