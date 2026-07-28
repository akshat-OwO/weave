import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const bunForVitest = {
  CryptoHasher: class CryptoHasher {
    readonly #hash;

    constructor(algorithm: string) {
      this.#hash = createHash(algorithm);
    }

    digest(encoding: "hex") {
      return this.#hash.digest(encoding);
    }

    update(data: string) {
      this.#hash.update(data);
      return this;
    }
  },
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
