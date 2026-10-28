import type { SessionMessageAssistant } from "@opencode/client"
import { createSignal, For, Show } from "solid-js"
import { ContentPart } from "@kilocode/kilo-ui/message-part"
import { Card } from "@kilocode/kilo-ui/card"
import { Collapsible } from "@kilocode/kilo-ui/collapsible"
import { Icon } from "@kilocode/kilo-ui/icon"
import { useToolMotion, useToolSize } from "@kilocode/kilo-ui/tool-motion"
import { useLanguage } from "../context/language"
import { useV2 } from "./client"

export function AssistantMessage(props: { message: SessionMessageAssistant; session: string }) {
  const v2 = useV2()
  const done = () => props.message.time.completed !== undefined
  const copy = () =>
    done() ? props.message.content.findLastIndex((item) => item.type === "text" && !!item.text.trim()) : -1
  return (
    <div
      class="vscode-session-turn"
      data-row="assistant"
      data-message={props.message.id}
      data-session={props.session}
      data-live={!done() ? "" : undefined}
    >
      <div class="vscode-session-turn-assistant">
        <For each={props.message.content}>
          {(item, index) => {
            const [el, setEl] = createSignal<HTMLDivElement>()
            const [body, setBody] = createSignal<HTMLDivElement>()
            const motion =
              item.type === "tool" ? useToolMotion({ id: item.id, status: () => item.state.status }) : undefined
            if (motion) useToolSize({ el, body, active: () => motion.live() && !done(), motion })
            return (
              <div
                ref={setEl}
                data-component="tool-part-wrapper"
                data-part-type={item.type}
                data-part-id={item.type === "tool" ? item.id : `${props.message.id}:${index()}`}
                data-tool-enter={motion?.entering() ? "" : undefined}
                data-tool-live={motion?.live() ? "" : undefined}
                data-tool-status={
                  item.type === "tool" ? (item.state.status === "streaming" ? "pending" : item.state.status) : undefined
                }
                style={{ "--tool-stagger": motion?.stagger(), "--tool-beat": motion?.beat() }}
                onAnimationEnd={(event) => {
                  if (event.animationName === "tool-motion-pop") return motion?.beaten()
                  if (event.target === event.currentTarget && event.animationName === "tool-motion-enter")
                    motion?.entered()
                }}
              >
                <div ref={setBody} data-slot="tool-part-body">
                  <ContentPart
                    item={item}
                    message={props.message}
                    index={index()}
                    directory={v2.directory}
                    open={v2.open}
                    copy={index() === copy()}
                    settled={index() < props.message.content.length - 1}
                    defaultOpen={item.type === "tool" && (item.name === "shell" || item.name === "todowrite")}
                  />
                </div>
              </div>
            )
          }}
        </For>
        <Show when={props.message.error}>{(error) => <ErrorCard error={error()} />}</Show>
      </div>
    </div>
  )
}

/** The error card of an assistant step. The message list also uses it for a run that fails before a step. */
export function ErrorCard(props: { error: { message: string } }) {
  const language = useLanguage()
  return (
    <Card variant="error" class="error-card" role="alert">
      <div class="error-card-body">
        <Icon name="warning" size="small" />
        <div class="error-card-message">{props.error.message}</div>
      </div>
      <Collapsible variant="ghost">
        <Collapsible.Trigger class="error-details-trigger">
          <span>{language.t("error.details.show")}</span>
          <Collapsible.Arrow />
        </Collapsible.Trigger>
        <Collapsible.Content>
          <pre>{JSON.stringify(props.error, null, 2)}</pre>
        </Collapsible.Content>
      </Collapsible>
    </Card>
  )
}
