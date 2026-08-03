// Morph's local provider already falls back to this command when its optional
// @vscode/ripgrep binary cannot run. Compiled Kilo binaries do not ship a
// node_modules tree, so resolve the provider directly through PATH instead.
export const rgPath = "rg"
