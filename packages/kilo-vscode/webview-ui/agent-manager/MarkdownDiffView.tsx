import { type Component, Show } from "solid-js"
import { Markdown } from "@kilocode/kilo-ui/markdown"

interface MarkdownDiffFile {
  file: string
  before: string
  after: string
  status?: "added" | "deleted" | "modified"
}

interface MarkdownDiffViewProps {
  diff: MarkdownDiffFile
}

export function isMarkdownFile(file: string): boolean {
  return /\.(md|mdx|markdown)$/i.test(file)
}

export const MarkdownDiffView: Component<MarkdownDiffViewProps> = (props) => {
  const before = () => (props.diff.status === "added" ? "" : props.diff.before)
  const after = () => (props.diff.status === "deleted" ? "" : props.diff.after)
  const split = () => before().length > 0 && after().length > 0 && before() !== after()

  return (
    <div class="am-markdown-diff" data-split={split() ? "true" : undefined}>
      <Show
        when={split()}
        fallback={
          <section class="am-markdown-pane">
            <Markdown text={after() || before()} cacheKey={`${props.diff.file}:rendered`} />
          </section>
        }
      >
        <>
          <section class="am-markdown-pane">
            <div class="am-markdown-pane-title">Before</div>
            <Markdown text={before()} cacheKey={`${props.diff.file}:before`} />
          </section>
          <section class="am-markdown-pane">
            <div class="am-markdown-pane-title">After</div>
            <Markdown text={after()} cacheKey={`${props.diff.file}:after`} />
          </section>
        </>
      </Show>
    </div>
  )
}
