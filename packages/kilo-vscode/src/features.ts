/**
 * Extension features on the Kilo v2 line. Only the chat path is on: the code of every other feature is not part of
 * this package yet (see the migration order in the PR that added it). A feature turns on here in the PR that ports
 * it onto the v2 server.
 *
 * `extension.ts` publishes each flag as the context key `kilo-code.new.feature.<name>`, so package.json `when`
 * clauses hide the title buttons and commands of features that are off.
 */
export const flags = {
  chat: true,
  agentManager: false,
  autocomplete: false,
  settings: false,
  marketplace: false,
  memory: false,
  indexing: false,
  sandbox: false,
  browserAutomation: false,
  notebook: false,
  legacyMigration: false,
  commitMessage: false,
  telemetry: false,
  remote: false,
  anacondaDesktop: false,
  speechToText: false,
  cloudSessions: false,
  backgroundJobs: false,
  suggestions: false,
  providerUsage: false,
  imageGeneration: false,
  terminals: false,
} as const

export type Flag = keyof typeof flags

export type Features = {
  indexing: boolean
  sandboxControls: boolean
  backgroundSubagents: boolean
  speechToText: boolean
}

/** The feature switches the webview reads. All of them belong to features that are off on v2. */
export function configFeatures(): Features {
  return {
    indexing: flags.indexing,
    sandboxControls: flags.sandbox,
    backgroundSubagents: flags.backgroundJobs,
    speechToText: flags.speechToText,
  }
}
