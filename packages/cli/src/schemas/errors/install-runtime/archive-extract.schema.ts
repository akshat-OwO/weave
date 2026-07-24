import { Schema } from "effect";

export class ArchiveExtractError extends Schema.TaggedErrorClass<ArchiveExtractError>()(
  "ArchiveExtractError",
  {}
) {}
