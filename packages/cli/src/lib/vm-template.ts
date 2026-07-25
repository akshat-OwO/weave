import path from "node:path";

import { Effect, FileSystem } from "effect";

import nodeWsl2TemplateAsset from "../../templates/node-wsl2.yaml" with { type: "file" };
import nodeTemplateAsset from "../../templates/node.yaml" with { type: "file" };
import pythonWsl2TemplateAsset from "../../templates/python-wsl2.yaml" with { type: "file" };
import pythonTemplateAsset from "../../templates/python.yaml" with { type: "file" };
import { InvalidVmTemplateError } from "../schemas/errors/invalid-vm-template.schema";

const PREDEFINED_TEMPLATE_NAMES = ["node", "python"] as const;
type PredefinedTemplateName = (typeof PREDEFINED_TEMPLATE_NAMES)[number];

const isPredefinedTemplateName = (
  template: string
): template is PredefinedTemplateName =>
  PREDEFINED_TEMPLATE_NAMES.some((name) => name === template);

const predefinedTemplateAssets: Record<PredefinedTemplateName, string> = {
  node:
    process.platform === "win32" ? nodeWsl2TemplateAsset : nodeTemplateAsset,
  python:
    process.platform === "win32"
      ? pythonWsl2TemplateAsset
      : pythonTemplateAsset,
};

const materializePredefinedTemplate = Effect.fn(
  "weave/services/vmTemplate/materializePredefinedTemplate"
)(function* materializePredefinedTemplateHandler(
  template: PredefinedTemplateName,
  configPath: string
) {
  const fs = yield* FileSystem.FileSystem;
  const templatesPath = path.join(configPath, "templates");
  const destinationPath = path.join(templatesPath, `${template}.yaml`);
  const contents = yield* Effect.tryPromise({
    catch: () =>
      new InvalidVmTemplateError({
        reason: "the embedded template could not be read",
        template,
      }),
    try: () => Bun.file(predefinedTemplateAssets[template]).text(),
  });

  yield* fs.makeDirectory(templatesPath, { recursive: true });
  yield* fs.writeFileString(destinationPath, contents);

  return destinationPath;
});

const resolveCustomTemplate = Effect.fn(
  "weave/services/vmTemplate/resolveCustomTemplate"
)(function* resolveCustomTemplateHandler(template: string) {
  const fs = yield* FileSystem.FileSystem;
  const templatePath = path.resolve(template);
  const extension = path.extname(templatePath).toLowerCase();

  if (extension !== ".yaml" && extension !== ".yml") {
    return yield* new InvalidVmTemplateError({
      reason: "expected a .yaml or .yml file",
      template,
    });
  }

  const exists = yield* fs.exists(templatePath);
  if (!exists) {
    return yield* new InvalidVmTemplateError({
      reason: "file does not exist",
      template,
    });
  }

  const info = yield* fs.stat(templatePath);
  if (info.type !== "File") {
    return yield* new InvalidVmTemplateError({
      reason: "path is not a file",
      template,
    });
  }

  return templatePath;
});

export const resolveVmTemplate = Effect.fn(
  "weave/services/vmTemplate/resolveVmTemplate"
)(function* resolveVmTemplateHandler(template: string, configPath: string) {
  if (isPredefinedTemplateName(template)) {
    return yield* materializePredefinedTemplate(template, configPath);
  }

  return yield* resolveCustomTemplate(template);
});
