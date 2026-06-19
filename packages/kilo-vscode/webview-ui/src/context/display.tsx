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

interface DisplayContextValue {
  reasoningAutoCollapse: Accessor<boolean>
  setReasoningAutoCollapse: (collapse: boolean) => void
  fontSize: Accessor<number>
  setFontSize: (size: number) => void
  limitChatContentWidth: Accessor<boolean>
  setLimitChatContentWidth: (limited: boolean) => void
}

export const DisplayContext = createContext<DisplayContextValue>()

function readChatContentWidthLimit() {
  const width = getComputedStyle(document.documentElement).getPropertyValue("--kilo-chat-content-width").trim()
  return width !== "100%"
}

export const DisplayProvider: ParentComponent = (props) => {
  const { config, updateConfig } = useConfig()
  const vscode = useVSCode()
  const reasoningAutoCollapse = createMemo(() => config().auto_collapse_reasoning ?? false)
  const [fontSize, setFontSizeSignal] = createSignal(readFontSize())
  const [limitChatContentWidth, setLimitChatContentWidthSignal] = createSignal(readChatContentWidthLimit())

  const unsubscribe = vscode.onMessage((message: ExtensionMessage) => {
    if (message.type === "ready" && message.fontSize !== undefined) setFontSizeSignal(clampFontSize(message.fontSize))
    if (message.type === "fontSizeChanged") setFontSizeSignal(clampFontSize(message.fontSize))
    if (message.type === "chatContentWidthLimitChanged") setLimitChatContentWidthSignal(message.limited)
  })

  createEffect(() => {
    applyFontSize(fontSize())
  })

  createEffect(() => {
    document.documentElement.style.setProperty(
      "--kilo-chat-content-width",
      limitChatContentWidth() ? "initial" : "100%",
    )
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
        limitChatContentWidth,
        setLimitChatContentWidth: (limited) => {
          setLimitChatContentWidthSignal(limited)
          vscode.postMessage({ type: "updateSetting", key: "limitChatContentWidth", value: limited })
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
