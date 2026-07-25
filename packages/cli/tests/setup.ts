import { readFile } from "node:fs/promises";
import path from "node:path";

const bunForVitest = {
  file: (filePath: string) => ({
    text: () => readFile(filePath, "utf-8"),
  }),
  resolveSync: (specifier: string, directory?: string) =>
    path.resolve(directory ?? path.join(process.cwd(), "src"), specifier),
};

Object.defineProperty(globalThis, "Bun", {
  configurable: true,
  value: bunForVitest,
});
