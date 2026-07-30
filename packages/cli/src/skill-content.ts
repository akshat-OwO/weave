import { Effect, FileSystem } from "effect";

import copySkillAsset from "../assets/skills/copy.md" with { type: "file" };
import coreSkillAsset from "../assets/skills/core.md" with { type: "file" };
import createSkillAsset from "../assets/skills/create.md" with { type: "file" };
import isolationSkillAsset from "../assets/skills/isolation.md" with { type: "file" };
import lifecycleSkillAsset from "../assets/skills/lifecycle.md" with { type: "file" };
import networkSkillAsset from "../assets/skills/network.md" with { type: "file" };

export const skillNames = [
  "core",
  "create",
  "copy",
  "lifecycle",
  "isolation",
  "network",
] as const;

export type SkillName = (typeof skillNames)[number];

interface SkillSection {
  readonly asset: string;
  readonly description: string;
}

export const skillSections: Readonly<Record<SkillName, SkillSection>> = {
  copy: {
    asset: copySkillAsset,
    description: "Copying host files into a guest VM",
  },
  core: {
    asset: coreSkillAsset,
    description: "Essential agent workflow and command selection",
  },
  create: {
    asset: createSkillAsset,
    description: "Provisioning, templates, resources, and mounts",
  },
  isolation: {
    asset: isolationSkillAsset,
    description: "Mount safety, data boundaries, and output retrieval",
  },
  lifecycle: {
    asset: lifecycleSkillAsset,
    description: "VM TTL, start, stop, deletion, and CLI maintenance",
  },
  network: {
    asset: networkSkillAsset,
    description: "Outbound access and localhost TCP port publishing",
  },
};

export const readSkillContent = Effect.fn(
  "weave/skillContent/readSkillContent"
)(function* readSkillContentHandler(skillName: SkillName) {
  const fs = yield* FileSystem.FileSystem;
  return yield* fs.readFileString(skillSections[skillName].asset);
});
