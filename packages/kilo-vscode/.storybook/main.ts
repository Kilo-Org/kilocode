import type { StorybookConfig } from "storybook-solidjs-vite"
import { mergeConfig } from "vite"
import solidPlugin from "vite-plugin-solid"

const config: StorybookConfig = {
  framework: "storybook-solidjs-vite",
  stories: ["../webview-ui/src/stories/**/*.stories.@(ts|tsx)"],
  addons: ["@storybook/addon-docs"],
  refs: {},
  viteFinal: async (config) => {
    return mergeConfig(config, {
      plugins: [solidPlugin()],
      resolve: {
        conditions: ["browser", "solid", "module", "import"],
      },
      esbuild: {
        jsxImportSource: "solid-js",
        jsx: "automatic",
      },
      worker: {
        format: "es",
      },
    })
  },
}

export default config
