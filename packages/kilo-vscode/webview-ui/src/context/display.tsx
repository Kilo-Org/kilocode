import {
  createContext,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  useContext,
  type Accessor,
  type ParentComponent,
} from "solid-js"
import { useConfig } from "./config"
import { useVSCode } from "./vscode"
import type { ExtensionMessage } from "../types/messages"
import { applyFontSize, clampFontSize, readFontSize } from "../font-size"
import { applyAnimations, type Animations } from "../animations"
import { resolveReasoningDisplay } from "../utils/reasoning-display"
import type { ReasoningDisplay } from "../types/messages"
import { ToolApprovalVisibilityProvider } from "@kilocode/kilo-ui/tool-approval"

interface DisplayContextValue {
  reasoningDisplay: Accessor<ReasoningDisplay>
  setReasoningDisplay: (mode: ReasoningDisplay) => void
  fontSize: Accessor<number>
  setFontSize: (size: number) => void
  // Shared throughput toggle — the same signal backs the per-message badge in
  // every AssistantMessage and the aggregated row in TaskHeader, so flipping
  // the setting once updates both surfaces without round-trips.
  throughputVisible: Accessor<boolean>
  // Whether the "why was this tool call approved" line renders on tool calls.
  autoApprovalReasonVisible: Accessor<boolean>
}

export const DisplayContext = createContext<DisplayContextValue>()

export const DisplayProvider: ParentComponent = (props) => {
  const { config, updateConfig } = useConfig()
  const vscode = useVSCode()
  const reasoningDisplay = createMemo(() => resolveReasoningDisplay(config()))
  const [fontSize, setFontSizeSignal] = createSignal(readFontSize())
  const [animations, setAnimations] = createSignal<Animations>("full")
  const [focused, setFocused] = createSignal(true)
  const [throughputVisible, setThroughputVisible] = createSignal(true)
  const [autoApprovalReasonVisible, setAutoApprovalReasonVisible] = createSignal(true)

  // Request both toggles once on mount; the extension posts back
  // (and onDidChangeConfiguration forwards subsequent edits).
  onMount(() => {
    vscode.postMessage({ type: "requestThroughputSetting" })
    vscode.postMessage({ type: "requestAutoApprovalReasonSetting" })
  })

  const unsubscribe = vscode.onMessage((message: ExtensionMessage) => {
    if (message.type === "ready" && message.fontSize !== undefined) setFontSizeSignal(clampFontSize(message.fontSize))
    if (message.type === "fontSizeChanged") setFontSizeSignal(clampFontSize(message.fontSize))
    if (message.type === "ready" && message.animations !== undefined) setAnimations(message.animations)
    if (message.type === "ready" && message.focused !== undefined) setFocused(message.focused)
    if (message.type === "animationsChanged") {
      setAnimations(message.animations)
      setFocused(message.focused)
    }
    if (message.type === "throughputSettingLoaded") setThroughputVisible(Boolean(message.visible))
    if (message.type === "autoApprovalReasonSettingLoaded") setAutoApprovalReasonVisible(Boolean(message.visible))
  })

  createEffect(() => {
    applyFontSize(fontSize())
  })

  createEffect(() => {
    applyAnimations(animations(), focused())
  })

  // A view that is not on screen has no reason to animate, and the extension
  // does not know about tab visibility.
  const visibility = () => {
    applyAnimations(animations(), focused())
  }
  onMount(() => {
    document.addEventListener("visibilitychange", visibility)
  })
  onCleanup(() => {
    document.removeEventListener("visibilitychange", visibility)
  })

  onCleanup(unsubscribe)

  return (
    <DisplayContext.Provider
      value={{
        reasoningDisplay,
        setReasoningDisplay: (mode) => updateConfig({ reasoning_display: mode }),
        fontSize,
        setFontSize: (size) => {
          const next = clampFontSize(size)
          setFontSizeSignal(next)
          vscode.postMessage({ type: "updateSetting", key: "fontSize", value: next })
        },
        throughputVisible,
        autoApprovalReasonVisible,
      }}
    >
      {/* Bridges the toggle into kilo-ui's generic gate so every tool render hides the line consistently. */}
      <ToolApprovalVisibilityProvider value={autoApprovalReasonVisible}>
        {props.children}
      </ToolApprovalVisibilityProvider>
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
