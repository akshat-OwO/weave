import { Schema } from "effect";

export class CommandExecutionError extends Schema.TaggedErrorClass<CommandExecutionError>()(
  "CommandExecutionError",
  {
    backend: Schema.NonEmptyString,
    command: Schema.NonEmptyString,
    exitCode: Schema.Int,
  }
) {
  override get message() {
    return `${this.backend} command exited with code ${this.exitCode}: ${this.command}`;
  }
}
