export * as KiloPromptInjected from "./injected.js"

/**
 * Metadata for a user prompt that Kilo composed or extended on the user's behalf, such as an expanded slash-command
 * template. A transcript shows the title instead of the template, which the model still receives. The shape matches
 * the reader in `packages/kilo-vscode/src/shared/injected-prompt.ts`.
 */
export function command(name: string, args: string) {
  const title = `/${name} ${args.trim()}`.trim()
  return { kilo: { injected: { title } } }
}
