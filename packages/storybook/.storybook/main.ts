import { defineMain } from "storybook-solidjs-vite"
import { existsSync, readdirSync, readFileSync } from "node:fs" // kilocode_change - upstream 17229d24f56, remove in the next sync
import path from "node:path"
import { fileURLToPath } from "node:url"
import tailwindcss from "@tailwindcss/vite"
import { playgroundCss } from "./playground-css-plugin.ts"

const here = path.dirname(fileURLToPath(import.meta.url))
const ui = path.resolve(here, "../../ui")
const sessionUi = path.resolve(here, "../../session-ui")
const app = path.resolve(here, "../../app/src")
const extensions = path.resolve(here, "../../gui-extensions/src")
const mocks = path.resolve(here, "./mocks")

// kilocode_change start - temporary port of upstream 17229d24f56 (anomalyco/opencode#55866), remove in the next sync
// Component tests import real modules by URL (`source("../src/…")`, `new URL("./x.fixture.tsx", import.meta.url)`),
// past the mock aliases. Read those paths from the specs so the dependency optimizer crawls exactly what they load.
const packages = path.resolve(here, "../..")
const componentTestModules = readdirSync(packages)
  .map((name) => path.join(packages, name, "component-tests"))
  .filter((dir) => existsSync(dir))
  .flatMap((dir) =>
    readdirSync(dir, { recursive: true, encoding: "utf8" })
      .filter((file) => file.endsWith(".spec.ts"))
      .flatMap((file) =>
        Array.from(readFileSync(path.join(dir, file), "utf8").matchAll(/["'](\.{1,2}\/[^"']+\.tsx?)["']/g), (match) =>
          path.resolve(dir, path.dirname(file), match[1]!),
        ),
      ),
  )
// kilocode_change end

export default defineMain({
  framework: {
    name: "storybook-solidjs-vite",
    options: { docgen: false },
  },
  addons: [
    "@storybook/addon-onboarding",
    "@storybook/addon-docs",
    "@storybook/addon-links",
    "@storybook/addon-a11y",
    "@storybook/addon-vitest",
  ],
  staticDirs: [path.resolve(here, "../../app/public")],
  stories: [
    "../../ui/src/**/*.stories.@(js|jsx|mjs|ts|tsx)",
    "../../session-ui/src/**/*.stories.@(js|jsx|mjs|ts|tsx)",
    "../../app/src/**/*.stories.@(js|jsx|mjs|ts|tsx)",
    "../../gui-extensions/src/**/*.stories.@(js|jsx|mjs|ts|tsx)",
  ],
  async viteFinal(config) {
    const { mergeConfig, searchForWorkspaceRoot } = await import("vite")
    // kilocode_change start - temporary port of upstream 17229d24f56 (anomalyco/opencode#55866), remove in the next sync
    const entry = (file: string) =>
      path.relative(config.root ?? process.cwd(), path.resolve(here, file)).replaceAll("\\", "/")
    // kilocode_change end
    const merged = mergeConfig(config, {
      plugins: [tailwindcss(), playgroundCss()],
      // kilocode_change start - temporary port of upstream 17229d24f56 (anomalyco/opencode#55866), remove in the next sync
      optimizeDeps: {
        // Without Storybook's optimizer plugin (removed below), Vite finds dependencies on first import and reloads
        // every open page, aborting component tests mid-import. Crawl the stories, the workers (the scan does not
        // follow `new Worker(new URL(…))`), the modules component tests load, and the preview with the Storybook
        // runtime that its virtual entry imports, so the first browser request never discovers a new dependency.
        entries: [
          entry("../../{ui,session-ui,app,gui-extensions}/src/**/*.{stories.tsx,worker.ts}"),
          ...new Set(componentTestModules.map(entry)),
          entry("./preview.tsx"),
        ],
        include: ["storybook/internal/preview/runtime"],
      },
      // kilocode_change end
      resolve: {
        // kilocode_change start - temporary port of upstream 17229d24f56 (anomalyco/opencode#55866), remove in the next sync. The removed @tanstack/solid-query alias pointed into app/node_modules
        // Storybook declares @tanstack/solid-query itself, so dedupe resolves one copy under both bun linkers. A path
        // into app/node_modules exists only with the isolated linker, not in a hoisted install.
        dedupe: ["solid-js", "solid-js/web", "@solidjs/meta", "@tanstack/solid-query"],
        // kilocode_change end
        alias: [
          { find: "@solidjs/router", replacement: path.resolve(mocks, "solid-router.tsx") },
          { find: /^@\/providers\/models\/selection$/, replacement: path.resolve(mocks, "app/context/local.ts") },
          { find: /^@\/workspaces\/files\/model$/, replacement: path.resolve(mocks, "app/context/file.ts") },
          { find: /^@\/shell\/state\/layout$/, replacement: path.resolve(mocks, "app/context/layout.ts") },
          { find: /^@\/workspaces\/location$/, replacement: path.resolve(mocks, "app/context/location.ts") },
          { find: /^@\/composer\/comments$/, replacement: path.resolve(mocks, "app/context/comments.ts") },
          { find: /^@\/shell\/commands\/command$/, replacement: path.resolve(mocks, "app/context/command.ts") },
          { find: /^@\/runtime\/platform\/platform$/, replacement: path.resolve(mocks, "app/context/platform.ts") },
          { find: /^@\/runtime\/server\/global-sync$/, replacement: path.resolve(mocks, "app/context/global-sync.ts") },
          { find: /^@\/runtime\/server\/sync$/, replacement: path.resolve(mocks, "app/context/server-sync.ts") },
          { find: /^@\/runtime\/server\/client$/, replacement: path.resolve(mocks, "app/context/server-sdk.ts") },
          { find: /^@\/runtime\/server\/current$/, replacement: path.resolve(mocks, "app/context/server-current.ts") },
          {
            find: /^@\/providers\/catalog\/providers$/,
            replacement: path.resolve(mocks, "app/hooks/use-providers.ts"),
          },
          {
            find: /^@\/providers\/models\/unpaid$/,
            replacement: path.resolve(mocks, "app/components/dialog-select-model-unpaid.tsx"),
          },
          { find: "@", replacement: app },
        ],
      },
      worker: {
        format: "es",
      },
      server: {
        fs: {
          allow: [searchForWorkspaceRoot(process.cwd()), ui, sessionUi, app, extensions, mocks],
        },
      },
    })
    merged.plugins = merged.plugins?.flat(8).filter((plugin) => {
      if (!plugin || typeof plugin !== "object" || !("name" in plugin)) return true
      return plugin.name !== "storybook:optimize-deps-plugin"
    })
    return merged
  },
})
