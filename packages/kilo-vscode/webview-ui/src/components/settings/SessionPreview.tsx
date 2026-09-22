import { createMemo, createUniqueId, onCleanup, onMount, Show, type Component } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import type { AssistantMessage as Message, Part, ToolPart, UserMessage } from "@kilocode/sdk/v2"
import { DataProvider } from "@kilocode/kilo-ui/context/data"
import { ToolApprovalVisibilityProvider, UserMessageDisplay } from "@kilocode/kilo-ui/message-part"
import { useConfig } from "../../context/config"
import { DisplayContext, useDisplay } from "../../context/display"
import { useLanguage } from "../../context/language"
import { resolveReasoningDisplay } from "../../utils/reasoning-display"
import { AssistantMessage } from "../chat/AssistantMessage"
import { previewDuration, previewFrame } from "./session-preview-playback"

const SessionPreview: Component = () => {
  const { config, settings } = useConfig()
  const display = useDisplay()
  const language = useLanguage()
  const reasoning = () => resolveReasoningDisplay(config())
  const throughput = () => Boolean(settings().showTokenThroughput ?? true)
  const approval = () => Boolean(settings().showAutoApprovalReason ?? true)
  const defaults = createMemo(
    () => `${config().terminal_command_display}:${config().code_edit_display}:${config().mcp_tool_display}`,
  )
  const fixture = createMemo(() => {
    // Tool defaults are captured on mount. Refresh IDs for those drafts, never for streaming ticks.
    defaults()
    const id = `settings-preview-${createUniqueId()}`
    const stamp = 1_700_000_000_000
    const tokens = { input: 120, output: 80, reasoning: 40, cache: { read: 0, write: 0 } }
    const user: UserMessage = {
      id: `${id}-user`,
      sessionID: id,
      role: "user",
      time: { created: stamp },
      agent: "",
      model: { providerID: "preview", modelID: language.t("settings.display.preview.model") },
    }
    const message: Message = {
      id: `${id}-assistant`,
      sessionID: id,
      parentID: user.id,
      role: "assistant",
      time: { created: stamp, completed: stamp + 3000 },
      modelID: "preview",
      providerID: "preview",
      mode: "default",
      agent: "default",
      path: { cwd: "/preview", root: "/preview" },
      cost: 0,
      tokens,
    }
    const thought: Message = {
      ...message,
      id: `${id}-reasoning`,
      time: { created: stamp, completed: stamp + 5000 },
    }
    const thoughts: Part[] = [
      {
        id: `${id}-thought`,
        sessionID: id,
        messageID: thought.id,
        type: "reasoning",
        text: language.t("settings.display.preview.reasoning"),
        time: { start: stamp, end: stamp + 5000 },
      },
    ]
    const tool = (name: string, input: Record<string, unknown>, output: string, metadata = {}): ToolPart => ({
      id: `${id}-${name}`,
      sessionID: id,
      messageID: message.id,
      type: "tool",
      callID: `${id}-${name}`,
      tool: name,
      state: {
        status: "completed",
        input,
        output,
        title: name,
        metadata: { ...metadata, approval: { source: "project" } },
        time: { start: stamp + 1000, end: stamp + 2000 },
      },
    })
    const parts: Part[] = [
      tool(
        "sample_docs_lookup",
        { query: language.t("settings.display.preview.query") },
        language.t("settings.display.preview.result"),
      ),
      tool(
        "edit",
        { filePath: "/preview/greeting.ts", oldString: "return name", newString: "return name.trim()" },
        "",
        {
          filediff: {
            file: "/preview/greeting.ts",
            patch:
              "--- greeting.ts\n+++ greeting.ts\n@@ -1,3 +1,3 @@\n export function greet(name: string) {\n-  return name\n+  return name.trim()\n }",
            additions: 1,
            deletions: 1,
          },
        },
      ),
      tool(
        "bash",
        { command: "bun test greeting.test.ts", description: language.t("settings.display.preview.shell") },
        language.t("settings.display.preview.shellOutput"),
      ),
      {
        id: `${id}-text`,
        sessionID: id,
        messageID: message.id,
        type: "text",
        text: language.t("settings.display.preview.answer"),
      },
      {
        id: `${id}-step`,
        sessionID: id,
        messageID: message.id,
        type: "step-finish",
        reason: "stop",
        cost: 0,
        tokens,
        time: { start: stamp, end: stamp + 14_000, elapsed: 8000 },
      },
    ]
    const prompt: Part[] = [
      {
        id: `${id}-prompt`,
        sessionID: id,
        messageID: user.id,
        type: "text",
        text: language.t("settings.display.preview.prompt"),
      },
    ]
    return {
      user,
      prompt,
      thought,
      thoughts,
      message,
      parts,
      copy: `${id}-text`,
    }
  })

  const Playback: Component<{ sample: ReturnType<typeof fixture> }> = (props) => {
    const sample = props.sample
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)")
    const [state, setState] = createStore(previewFrame(sample, 0, motion.matches))
    let body: HTMLDivElement | undefined
    let content: HTMLDivElement | undefined
    let following = true
    onMount(() => {
      // Paint frames schedule playback, but only painted time counts, so time
      // spent hidden or occluded does not advance the loop. State updates stay
      // on the previous 50 ms cadence instead of once per paint frame.
      const step = 50
      const limit = 100
      let painted = 0
      let applied = 0
      let last = performance.now()
      let raf = requestAnimationFrame(function tick(now) {
        raf = requestAnimationFrame(tick)
        const delta = now - last
        last = now
        if (document.hidden) return
        painted += Math.min(delta, limit)
        if (painted - applied < step) return
        applied = painted
        setState(reconcile(previewFrame(sample, painted % previewDuration, motion.matches)))
      })
      const observer = new ResizeObserver(() => {
        if (following && body) body.scrollTop = body.scrollHeight
      })
      if (content) observer.observe(content)
      onCleanup(() => {
        cancelAnimationFrame(raf)
        observer.disconnect()
      })
    })
    const data = () => ({
      session: [],
      session_status: {},
      session_diff: {},
      message: { [sample.user.sessionID]: [sample.user, state.thought, state.message] },
      part: { [sample.user.id]: sample.prompt, [state.thought.id]: state.thoughts, [state.message.id]: state.parts },
    })
    return (
      <DataProvider data={data()} directory="/preview">
        <div
          ref={body}
          class="settings-session-preview-body"
          onScroll={() => {
            if (body) following = body.scrollHeight - body.scrollTop - body.clientHeight < 32
          }}
        >
          <div ref={content} class="settings-session-preview-content">
            <UserMessageDisplay message={sample.user} parts={sample.prompt} />
            <AssistantMessage message={state.thought} parts={state.thoughts} readonly interactivePrompts={false} />
            <AssistantMessage
              message={state.message}
              parts={state.parts}
              showAssistantCopyPartID={state.message.time.completed ? sample.copy : undefined}
              readonly
              interactivePrompts={false}
            />
          </div>
        </div>
      </DataProvider>
    )
  }

  return (
    <section class="settings-session-preview" aria-label={language.t("settings.display.preview.title")}>
      <div class="settings-session-preview-header">
        <h3 class="settings-session-preview-title">{language.t("settings.display.preview.title")}</h3>
      </div>
      <DisplayContext.Provider
        value={{
          ...display,
          reasoningDisplay: reasoning,
          throughputVisible: throughput,
          autoApprovalReasonVisible: approval,
        }}
      >
        <ToolApprovalVisibilityProvider value={approval}>
          <Show when={fixture()} keyed>
            {(sample) => <Playback sample={sample} />}
          </Show>
        </ToolApprovalVisibilityProvider>
      </DisplayContext.Provider>
    </section>
  )
}

export default SessionPreview
