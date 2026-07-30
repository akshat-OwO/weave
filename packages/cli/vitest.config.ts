import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    {
      enforce: "pre",
      load(id) {
        if (id.endsWith(".md") || id.endsWith(".yaml")) {
          return `export default ${JSON.stringify(id)}`;
        }
      },
      name: "weave-file-assets",
    },
  ],
  test: {
    exclude: [...configDefaults.exclude, "tests/integration/**"],
    setupFiles: ["./tests/setup.ts"],
  },
});
