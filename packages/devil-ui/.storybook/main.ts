import type { StorybookConfig } from "storybook-solidjs-vite"
import { mergeConfig } from "vite"
import solidPlugin from "vite-plugin-solid"

const config: StorybookConfig = {
  framework: "storybook-solidjs-vite",
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  addons: ["@storybook/addon-docs", "@storybook/addon-themes", "@storybook/addon-a11y"],
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
