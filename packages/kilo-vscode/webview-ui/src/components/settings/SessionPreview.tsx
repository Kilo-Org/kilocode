import type {
  JsonValue,
  SessionMessageAssistant,
  SessionMessageAssistantTool,
  SessionMessageUser,
} from "@opencode/client"
import { ToolApprovalVisibilityProvider } from "@kilocode/kilo-ui/message-part"
import { touch, useReducedMotion } from "@kilocode/kilo-ui/tool-motion"
import { createMemo, createUniqueId, onCleanup, onMount, Show, type Component } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { useLanguage } from "../../context/language"
import { AssistantMessage } from "../../v2/assistant"
import { autoApprovalReasonVisible } from "../../v2/kilo-settings"
import type { TurnMetadata } from "../../v2/message-status"
import { UserMessage } from "../../v2/user"
import { previewDuration, previewFrame } from "./session-preview-playback"

const SessionPreview: Component = () => {
  const language = useLanguage()
  const approval = () => autoApprovalReasonVisible()
  const fixture = createMemo(() => {
    const id = `settings-preview-${createUniqueId()}`
    const stamp = 1_700_000_000_000
    const tokens = { input: 120, output: 80, reasoning: 40, cache: { read: 0, write: 0 } }
    const user: SessionMessageUser = {
      id: `${id}-user`,
      time: { created: stamp },
      text: language.t("settings.display.preview.prompt"),
      type: "user",
    }
    const tool = (
      name: string,
      input: Record<string, JsonValue>,
      output: string,
      metadata: Record<string, JsonValue> = {},
    ): SessionMessageAssistantTool => ({
      type: "tool" as const,
      id: `${id}-${name}`,
      name,
      state: {
        status: "completed" as const,
        input,
        content: [{ type: "text" as const, text: output }],
        metadata: { ...metadata, approval: { source: "project" } },
      },
      time: { created: stamp + 1000, ran: stamp + 2000, completed: stamp + 2000 },
    })
    const message: SessionMessageAssistant = {
      id: `${id}-assistant`,
      time: { created: stamp },
      type: "assistant",
      agent: "default",
      model: { id: "preview", providerID: "preview" },
      cost: 0,
      tokens,
      content: [
        {
          type: "reasoning",
          text: language.t("settings.display.preview.reasoning"),
          time: { created: stamp },
        },
        tool(
          "sample_docs_lookup",
          { query: language.t("settings.display.preview.query") },
          language.t("settings.display.preview.result"),
        ),
        tool(
          "edit",
          {
            path: "/preview/greeting.ts",
            oldString: "return name",
            newString: "return name.trim()",
          },
          "",
          {
            files: [
              {
                file: "/preview/greeting.ts",
                patch:
                  "--- greeting.ts\n+++ greeting.ts\n@@ -1,3 +1,3 @@\n export function greet(name: string) {\n-  return name\n+  return name.trim()\n }",
                additions: 1,
                deletions: 1,
                status: "modified",
              },
            ],
          },
        ),
        tool(
          "execute",
          {
            code: [
              'const matches = await tools.grep({ pattern: "greet(", path: "src" })',
              'const file = await tools.read({ filePath: "/preview/greeting.ts" })',
              "return { matches, file }",
            ].join("\n"),
          },
          JSON.stringify(
            {
              matches: ["src/greeting.ts:1:export function greet(name: string) {"],
              file: "export function greet(name: string) {\n  return name.trim()\n}",
            },
            null,
            2,
          ),
          {
            toolCalls: [
              { tool: "grep", status: "completed", input: { pattern: "greet(", path: "src" } },
              { tool: "read", status: "completed", input: { filePath: "/preview/greeting.ts" } },
            ],
          },
        ),
        tool(
          "shell",
          {
            command: "bun test greeting.test.ts",
            description: language.t("settings.display.preview.shell"),
          },
          language.t("settings.display.preview.shellOutput"),
        ),
        {
          type: "text",
          text: language.t("settings.display.preview.answer"),
        },
      ],
    }
    const metadata: TurnMetadata = {
      carrierID: message.id,
      timing: { completedAt: stamp + 2500, durationMs: 8000 },
      tokensPerSecond: 42,
    }
    return { user, message, metadata }
  })

  const Playback: Component<{ sample: ReturnType<typeof fixture> }> = (props) => {
    const sample = props.sample
    const reduce = useReducedMotion()
    const [state, setState] = createStore(previewFrame(sample, 0, reduce()))
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
        const cycle = Math.floor(painted / previewDuration)
        const frame = previewFrame(sample, painted % previewDuration, reduce(), cycle)
        for (const part of frame.message.content) if (part.type === "tool") touch(part.id)
        setState(reconcile(frame))
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
    const meta = () => (state.message.time.completed === undefined ? undefined : sample.metadata)
    return (
      <div
        ref={body}
        class="settings-session-preview-body"
        onScroll={() => {
          if (body) following = body.scrollHeight - body.scrollTop - body.clientHeight < 32
        }}
      >
        {/* The real message rows, so spacing matches a real session. */}
        <div ref={content} class="settings-session-preview-content">
          <UserMessage message={sample.user} />
          <AssistantMessage message={state.message} session={state.message.id} metadata={meta()} />
        </div>
      </div>
    )
  }

  return (
    <section class="settings-session-preview" aria-label={language.t("settings.display.preview.title")}>
      <div class="settings-session-preview-header">
        <h3 class="settings-session-preview-title" data-search-label={language.t("settings.display.preview.title")}>
          {language.t("settings.display.preview.title")}
        </h3>
      </div>
      <ToolApprovalVisibilityProvider value={approval}>
        <Show when={fixture()} keyed>
          {(sample) => <Playback sample={sample} />}
        </Show>
      </ToolApprovalVisibilityProvider>
    </section>
  )
}

export default SessionPreview
