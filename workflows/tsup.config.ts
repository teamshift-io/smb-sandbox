import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts", cli: "src/cli.ts" },
  format: ["esm"],
  target: "node20",
  dts: { entry: { index: "src/index.ts" } },
  clean: true,
  sourcemap: false,
  splitting: true,
  // task.md files are the single source of truth for prompts; bundle them as text.
  loader: { ".md": "text" },
  external: ["@teamshift/fake-business", "@teamshift/sandbox-mcp"],
});
