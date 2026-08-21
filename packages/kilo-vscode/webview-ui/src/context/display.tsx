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
import type { ExtensionMessage, ReasoningDisplay } from "../types/messages"
import { applyFontSize, clampFontSize, readFontSize } from "../font-size"
import { ToolApprovalVisibilityProvider } from "@kilocode/kilo-ui/message-part"

interface DisplayContextValue {
  reasoningDisplay: Accessor<ReasoningDisplay>
  setReasoningDisplay: (mode: ReasoningDisplay) => void
  inlineCodeBackground: Accessor<boolean>
  setInlineCodeBackground: (enabled: boolean) => void
  inlineCodeColor: Accessor<string | undefined>
  setInlineCodeColor: (color: string | undefined) => void
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
  const reasoningDisplay = createMemo<ReasoningDisplay>(
    () => config().reasoning_display ?? (config().auto_collapse_reasoning === true ? "shortened" : "full_persist"),
  )
  const inlineCodeBackground = createMemo(() => config().inline_code_background === true)
  const inlineCodeColor = createMemo(() => config().inline_code_color)
  const [fontSize, setFontSizeSignal] = createSignal(readFontSize())
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
    if (message.type === "throughputSettingLoaded") setThroughputVisible(Boolean(message.visible))
    if (message.type === "autoApprovalReasonSettingLoaded") setAutoApprovalReasonVisible(Boolean(message.visible))
  })

  createEffect(() => {
    applyFontSize(fontSize())
  })

  // Keep the inherited shared-UI default unless the Kilo webview setting is explicitly enabled.
  createEffect(() => {
    const root = document.documentElement
    const attribute = "data-kilo-inline-code-background"
    root.toggleAttribute(attribute, inlineCodeBackground())
    onCleanup(() => root.removeAttribute(attribute))
  })

  // Inline-code color override → CSS var read by markdown.css :not(pre) > code.
  // Blank/unset removes the property so inline code falls back to the theme color.
  createEffect(() => {
    const root = document.documentElement
    const color = inlineCodeColor()
    if (color && color.trim()) root.style.setProperty("--kilo-inline-code-color", color)
    else root.style.removeProperty("--kilo-inline-code-color")
  })

  // Pierre renders diff rows inside a shadow root. Publish inherited colors here;
  // kilo-ui's renderer-owned unsafeCSS applies them inside that shadow root.
  createEffect(() => {
    const root = document.documentElement
    const addition = "--kilo-diff-line-add-background"
    const deletion = "--kilo-diff-line-delete-background"

    if (config().diff_line_backgrounds === true) {
      root.style.setProperty(addition, "var(--vscode-diffEditor-insertedLineBackground, rgba(46, 160, 67, 0.18))")
      root.style.setProperty(deletion, "var(--vscode-diffEditor-removedLineBackground, rgba(248, 81, 73, 0.18))")
    } else {
      root.style.removeProperty(addition)
      root.style.removeProperty(deletion)
    }

    onCleanup(() => {
      root.style.removeProperty(addition)
      root.style.removeProperty(deletion)
    })
  })

  onCleanup(unsubscribe)

  return (
    <DisplayContext.Provider
      value={{
        reasoningDisplay,
        setReasoningDisplay: (mode) => updateConfig({ reasoning_display: mode }),
        inlineCodeBackground,
        setInlineCodeBackground: (enabled) => updateConfig({ inline_code_background: enabled || undefined }),
        inlineCodeColor,
        setInlineCodeColor: (color) => updateConfig({ inline_code_color: color?.trim() || undefined }),
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
