import { defineConfig } from "oxlint";
import core from "ultracite/oxlint/core";

export default defineConfig({
  extends: [core],
  ignorePatterns: core.ignorePatterns,
  rules: {
    "promise/prefer-await-to-callbacks": "off",
    "promise/prefer-await-to-then": "off",
  },
});
