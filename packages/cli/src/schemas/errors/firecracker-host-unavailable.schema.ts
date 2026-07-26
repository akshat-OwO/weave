import { Schema } from "effect";

export class FirecrackerHostUnavailableError extends Schema.TaggedErrorClass<FirecrackerHostUnavailableError>()(
  "FirecrackerHostUnavailableError",
  {
    reason: Schema.NonEmptyString,
  }
) {
  override get message() {
    return `Firecracker is unavailable: ${this.reason}`;
  }
}
