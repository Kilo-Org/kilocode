import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import path from "node:path";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: rootDir,
  resolve: {
    alias: {
      core: path.resolve(rootDir),
    },
  },
  test: {
    testTransformMode: {
      web: ["/.[jt]s?$/"],
      ssr: ["/.[jt]s?$/"],
    },
    globalSetup: path.resolve(rootDir, "test/vitest.global-setup.ts"),
    setupFiles: path.resolve(rootDir, "test/vitest.setup.ts"),
    fileParallelism: false,
    include: ["**/*.vitest.ts"],
    exclude: ["**/node_modules/**"],
  },
});
