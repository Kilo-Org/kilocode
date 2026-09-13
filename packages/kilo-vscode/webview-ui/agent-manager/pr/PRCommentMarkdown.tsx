import { For, Show, createMemo } from "solid-js"
import { Marked } from "marked"
import { Markdown } from "@kilocode/kilo-ui/markdown"
import { useLanguage } from "../../src/context/language"
import type { PRTarget } from "../../../src/shared/pr-comment-actions"
import { PRSuggestion } from "./PRSuggestion"

const marked = new Marked()

export function PRCommentMarkdown(props: { text: string; published?: PRTarget & { commentId: string } }) {
  const { t } = useLanguage()
  const blocks = createMemo(() => {
    const tokens = marked.lexer(props.text)
    const blocks: { text: string; suggestion?: boolean; ordinal?: number }[] = []
    let ordinal = 0
    for (const token of tokens) {
      if (token.type === "code" && /^suggestion(?::[-+]?\d+[-+]\d+)?$/.test(token.lang ?? "")) {
        blocks.push({ text: token.text, suggestion: true, ordinal: ordinal++ })
        continue
      }
      const last = blocks.at(-1)
      if (last && !last.suggestion) {
        last.text += token.raw
        continue
      }
      blocks.push({ text: token.raw })
    }
    if (!blocks.some((block) => block.suggestion)) return [{ text: props.text, suggestion: false }]
    // Keep reference links valid when a suggestion separates their definitions.
    const definitions = tokens
      .filter((token) => token.type === "def")
      .map((token) => token.raw)
      .join("\n")
    return blocks.map((block) => (block.suggestion ? block : { text: `${block.text}\n\n${definitions}` }))
  })

  return (
    <For each={blocks()}>
      {(block) => (
        <Show when={block.suggestion} fallback={<Markdown text={block.text} />}>
          <div data-slot="suggested-change">
            <div data-slot="suggested-change-label">{t("agentManager.pr.comment.suggestedChange")}</div>
            <pre>
              <code>{block.text}</code>
            </pre>
          </div>
          <Show when={props.published}>{(target) => <PRSuggestion {...target()} suggestion={block.ordinal!} />}</Show>
        </Show>
      )}
    </For>
  )
}
