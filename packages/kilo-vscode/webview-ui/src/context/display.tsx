import {
  createContext,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  useContext,
  type Accessor,
  type ParentComponent,
} from "solid-js"
import { useConfig } from "./config"
import { useVSCode } from "./vscode"
import type { ExtensionMessage } from "../types/messages"
import { applyFontSize, clampFontSize, readFontSize } from "../font-size"

function applyFontFamily(family: string) {
  const root = document.documentElement
  if (family) {
    const escaped = family.replace(/'/g, "\\'")
    root.style.setProperty("--vscode-font-family", `'${escaped}', sans-serif`)
  } else {
    root.style.removeProperty("--vscode-font-family")
  }
}

interface DisplayContextValue {
  reasoningAutoCollapse: Accessor<boolean>
  setReasoningAutoCollapse: (collapse: boolean) => void
  fontSize: Accessor<number>
  setFontSize: (size: number) => void
  fontFamily: Accessor<string>
  setFontFamily: (family: string) => void
}

export const DisplayContext = createContext<DisplayContextValue>()

export const DisplayProvider: ParentComponent = (props) => {
  const { config, updateConfig } = useConfig()
  const vscode = useVSCode()
  const reasoningAutoCollapse = createMemo(() => config().auto_collapse_reasoning ?? false)
  const [fontSize, setFontSizeSignal] = createSignal(readFontSize())
  const [fontFamily, setFontFamilySignal] = createSignal("")

  const unsubscribe = vscode.onMessage((message: ExtensionMessage) => {
    if (message.type === "ready" && message.fontSize !== undefined) setFontSizeSignal(clampFontSize(message.fontSize))
    if (message.type === "fontSizeChanged") setFontSizeSignal(clampFontSize(message.fontSize))
    if (message.type === "ready" && message.fontFamily !== undefined) setFontFamilySignal(message.fontFamily)
    if (message.type === "fontFamilyChanged") setFontFamilySignal(message.fontFamily)
  })

  createEffect(() => {
    applyFontSize(fontSize())
  })

  createEffect(() => {
    applyFontFamily(fontFamily())
  })

  onCleanup(unsubscribe)

  return (
    <DisplayContext.Provider
      value={{
        reasoningAutoCollapse,
        setReasoningAutoCollapse: (collapse) => updateConfig({ auto_collapse_reasoning: collapse }),
        fontSize,
        setFontSize: (size) => {
          const next = clampFontSize(size)
          setFontSizeSignal(next)
          vscode.postMessage({ type: "updateSetting", key: "fontSize", value: next })
        },
        fontFamily,
        setFontFamily: (family) => {
          setFontFamilySignal(family)
          vscode.postMessage({ type: "updateSetting", key: "fontFamily", value: family })
        },
      }}
    >
      {props.children}
    </DisplayContext.Provider>
  )
}

export function useDisplay(): DisplayContextValue {
  const context = useContext(DisplayContext)
  if (!context) {
    throw new Error("useDisplay must be used within a DisplayProvider")
  }
  return context
}
