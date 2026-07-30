import { Console, Effect } from "effect";
import { Argument, Command } from "effect/unstable/cli";

import { readSkillContent, skillNames, skillSections } from "../skill-content";

const skill = Argument.choice("skill", skillNames).pipe(
  Argument.withDescription("Skill section to print")
);

const get = Command.make("get", { skill }, ({ skill: skillName }) =>
  readSkillContent(skillName).pipe(Effect.flatMap(Console.log))
).pipe(
  Command.withDescription("Print version-matched agent instructions"),
  Command.withExamples([{ command: "weave skills get core" }])
);

const list = Command.make("list", {}, () =>
  Console.log(
    skillNames
      .map(
        (skillName) => `${skillName}\t${skillSections[skillName].description}`
      )
      .join("\n")
  )
).pipe(Command.withDescription("List available agent instruction sections"));

export const skills = Command.make("skills").pipe(
  Command.withDescription("Serve version-matched instructions for AI agents"),
  Command.withSubcommands([get, list])
);
