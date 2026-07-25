import { expect, it } from "@effect/vitest";
import { Effect, FileSystem } from "effect";
import { describe } from "vitest";

import { resolveVmTemplate } from "../../src/lib/vm-template";

describe("resolveVmTemplate", () => {
  it.effect("materializes both embedded templates under the config path", () =>
    Effect.gen(function* predefinedTemplatesTest() {
      const writes: (readonly [string, string])[] = [];
      const fs = FileSystem.makeNoop({
        makeDirectory: () => Effect.void,
        writeFileString: (path, contents) =>
          Effect.sync(() => {
            writes.push([path, contents]);
          }),
      });

      for (const name of ["node", "python"] as const) {
        expect(
          yield* resolveVmTemplate(name, "/test/weave").pipe(
            Effect.provideService(FileSystem.FileSystem, fs)
          )
        ).toBe(`/test/weave/templates/${name}.yaml`);
      }

      expect(writes).toHaveLength(2);
      expect(writes.every(([, contents]) => contents.length > 0)).toBe(true);
    })
  );

  it.effect("resolves an existing custom YAML file", () =>
    Effect.gen(function* customTemplateTest() {
      const fs = FileSystem.makeNoop({
        exists: () => Effect.succeed(true),
        stat: () => Effect.succeed({ type: "File" } as FileSystem.File.Info),
      });
      const result = yield* resolveVmTemplate("./custom.yml", "/unused").pipe(
        Effect.provideService(FileSystem.FileSystem, fs)
      );

      expect(result).toMatch(/\/custom\.yml$/u);
    })
  );

  it.effect("rejects invalid extensions, missing paths, and directories", () =>
    Effect.gen(function* invalidCustomTemplatesTest() {
      const cases = [
        {
          fileSystem: FileSystem.makeNoop({}),
          template: "./custom.json",
        },
        {
          fileSystem: FileSystem.makeNoop({
            exists: () => Effect.succeed(false),
          }),
          template: "./missing.yaml",
        },
        {
          fileSystem: FileSystem.makeNoop({
            exists: () => Effect.succeed(true),
            stat: () =>
              Effect.succeed({ type: "Directory" } as FileSystem.File.Info),
          }),
          template: "./templates.yaml",
        },
      ];

      for (const { fileSystem, template } of cases) {
        const error = yield* Effect.flip(
          resolveVmTemplate(template, "/unused").pipe(
            Effect.provideService(FileSystem.FileSystem, fileSystem)
          )
        );
        expect(error).toMatchObject({
          _tag: "InvalidVmTemplateError",
          template,
        });
      }
    })
  );
});
