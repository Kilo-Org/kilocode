import { hasIndexingPlugin } from "@kilocode/kilo-indexing/detect"
import * as vscode from "vscode"

type PluginSpec = string | [string, Record<string, unknown>]

type ConfigLike = {
  plugin?: readonly PluginSpec[] | null
}

export type Features = {
  indexing: boolean
  sandboxControls: boolean
  speechToText: boolean
}

export function configFeatures(config?: ConfigLike | null, remote = !!vscode.env.remoteName): Features {
  return {
    indexing: hasIndexingPlugin(config?.plugin ?? []),
    sandboxControls: process.platform !== "win32",
    speechToText: !remote,
  }
}
