import { eslintCompatPlugin } from "@oxlint/plugins"
import { requireViewActiveGuardRule } from "./require-view-active-guard.mts"

const kiloVscodePlugin = eslintCompatPlugin({
  meta: { name: "kilo-vscode" },
  rules: {
    "require-view-active-guard": requireViewActiveGuardRule,
  },
})

export default kiloVscodePlugin
