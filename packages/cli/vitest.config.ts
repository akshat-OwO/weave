import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    {
      enforce: "pre",
      load(id) {
        if (id.endsWith(".yaml")) {
          return `export default ${JSON.stringify(id)}`;
        }
      },
      name: "weave-file-assets",
    },
  ],
  test: {
    setupFiles: ["./tests/setup.ts"],
  },
});
