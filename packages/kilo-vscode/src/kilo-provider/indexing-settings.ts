import { workspace, type Disposable } from "vscode"
import type { IndexingProject } from "../protocol"

const NAMESPACE = "kilo-code.v2.indexing"

export function buildIndexingSettingsMessage(consent = false, projects: IndexingProject[] = [], projectId?: string) {
  const config = workspace.getConfiguration(NAMESPACE)
  return {
    type: "indexingSettingsLoaded" as const,
    settings: {
      showButtonWhenDisabled: config.get<boolean>("showButtonWhenDisabled", true),
      consent,
      projects,
      projectId,
    },
  }
}

export function watchIndexingConfig(post: () => void): Disposable {
  return workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration(NAMESPACE)) {
      post()
    }
  })
}

export function validIndexingSetting(key: string, value: unknown) {
  return key === "showButtonWhenDisabled" && typeof value === "boolean"
}
