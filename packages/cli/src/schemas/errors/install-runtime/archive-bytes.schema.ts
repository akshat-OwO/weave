import { Schema } from "effect";

export class ArchiveBytesError extends Schema.TaggedErrorClass<ArchiveBytesError>()(
  "ArchiveBytesError",
  {}
) {}
