/**
 * ImageModeContext
 * Provides the current image attachment mode setting ("data" or "path").
 * "data" sends base64 data URLs, "path" sends file:// paths for MCP servers.
 */

import { createContext, useContext, createSignal, onCleanup, ParentComponent } from "solid-js"
import type { Accessor } from "solid-js"
import { useVSCode } from "./vscode"
import type { ExtensionMessage } from "../types/messages"

export type ImageMode = "data" | "path"

interface ImageModeContextValue {
  imageMode: Accessor<ImageMode>
}

export const ImageModeContext = createContext<ImageModeContextValue>()

export const ImageModeProvider: ParentComponent = (props) => {
  const vscode = useVSCode()
  const [imageMode, setImageMode] = createSignal<ImageMode>("data")

  const unsubscribe = vscode.onMessage((message: ExtensionMessage) => {
    if (message.type === "imageModeLoaded") {
      setImageMode(message.mode)
    }
  })

  onCleanup(unsubscribe)

  // Request initial value and listen for changes
  vscode.postMessage({ type: "requestImageMode" })

  const value: ImageModeContextValue = { imageMode }

  return <ImageModeContext.Provider value={value}>{props.children}</ImageModeContext.Provider>
}

export function useImageModeContext(): ImageModeContextValue {
  const context = useContext(ImageModeContext)
  if (!context) {
    throw new Error("useImageModeContext must be used within an ImageModeProvider")
  }
  return context
}

export function useImageMode(): Accessor<ImageMode> {
  return useImageModeContext().imageMode
}
