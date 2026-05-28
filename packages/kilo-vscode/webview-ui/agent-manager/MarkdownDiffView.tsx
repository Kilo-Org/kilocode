import { type Component, Show } from "solid-js"
import type { AnnotationSide, DiffLineAnnotation, SelectedLineRange } from "@pierre/diffs"
import { Markdown } from "@kilocode/kilo-ui/markdown"
import { MarkdownAnnotationLayer } from "./MarkdownAnnotationLayer"
import type { AnnotationMeta } from "./review-annotations"

interface MarkdownDiffFile {
  file: string
  before: string
  after: string
  status?: "added" | "deleted" | "modified"
}

interface MarkdownDiffViewProps {
  diff: MarkdownDiffFile
  annotations?: DiffLineAnnotation<AnnotationMeta>[]
  renderAnnotation?: (annotation: DiffLineAnnotation<AnnotationMeta>) => HTMLElement | undefined
  enableGutterUtility?: boolean
  onGutterUtilityClick?: (range: SelectedLineRange) => void
  onLineNumberClick?: (event: { annotationSide: AnnotationSide; lineNumber: number }) => void
}

export function isMarkdownFile(file: string): boolean {
  return /\.(md|mdx|markdown)$/i.test(file)
}

interface PaneProps {
  title?: string
  text: string
  side: AnnotationSide
  cache: string
  annotations: DiffLineAnnotation<AnnotationMeta>[]
  renderAnnotation: ((annotation: DiffLineAnnotation<AnnotationMeta>) => HTMLElement | undefined) | undefined
  enableGutterUtility: boolean
  onGutterUtilityClick: ((range: SelectedLineRange) => void) | undefined
  onLineNumberClick: ((event: { annotationSide: AnnotationSide; lineNumber: number }) => void) | undefined
}

const MarkdownPane: Component<PaneProps> = (props) => {
  let pane: HTMLElement | undefined
  let body: HTMLDivElement | undefined
  const interactive = () =>
    props.enableGutterUtility || props.onLineNumberClick !== undefined || props.annotations.length > 0
  const root = () => body?.querySelector<HTMLElement>('[data-component="markdown"]') ?? undefined

  return (
    <section class="am-markdown-pane" data-comments={interactive() ? "true" : undefined} ref={pane}>
      <Show when={props.title}>{(title) => <div class="am-markdown-pane-title">{title()}</div>}</Show>
      <div class="am-markdown-body" ref={body}>
        <Markdown text={props.text} cacheKey={props.cache} />
      </div>
      <Show when={interactive()}>
        <MarkdownAnnotationLayer
          pane={() => pane}
          root={root}
          text={props.text}
          side={props.side}
          annotations={props.annotations}
          renderAnnotation={props.renderAnnotation}
          enableGutterUtility={props.enableGutterUtility}
          onGutterUtilityClick={props.onGutterUtilityClick}
          onLineNumberClick={props.onLineNumberClick}
        />
      </Show>
    </section>
  )
}

export const MarkdownDiffView: Component<MarkdownDiffViewProps> = (props) => {
  const before = () => (props.diff.status === "added" ? "" : props.diff.before)
  const after = () => (props.diff.status === "deleted" ? "" : props.diff.after)
  const split = () => before().length > 0 && after().length > 0 && before() !== after()
  const side = () => (after().length > 0 ? "additions" : "deletions") as AnnotationSide
  const annotations = () => props.annotations ?? []

  return (
    <div class="am-markdown-diff" data-split={split() ? "true" : undefined}>
      <Show
        when={split()}
        fallback={
          <MarkdownPane
            text={after() || before()}
            side={side()}
            cache={`${props.diff.file}:rendered`}
            annotations={annotations()}
            renderAnnotation={props.renderAnnotation}
            enableGutterUtility={props.enableGutterUtility === true}
            onGutterUtilityClick={props.onGutterUtilityClick}
            onLineNumberClick={props.onLineNumberClick}
          />
        }
      >
        <>
          <MarkdownPane
            title="Before"
            text={before()}
            side="deletions"
            cache={`${props.diff.file}:before`}
            annotations={annotations()}
            renderAnnotation={props.renderAnnotation}
            enableGutterUtility={props.enableGutterUtility === true}
            onGutterUtilityClick={props.onGutterUtilityClick}
            onLineNumberClick={props.onLineNumberClick}
          />
          <MarkdownPane
            title="After"
            text={after()}
            side="additions"
            cache={`${props.diff.file}:after`}
            annotations={annotations()}
            renderAnnotation={props.renderAnnotation}
            enableGutterUtility={props.enableGutterUtility === true}
            onGutterUtilityClick={props.onGutterUtilityClick}
            onLineNumberClick={props.onLineNumberClick}
          />
        </>
      </Show>
    </div>
  )
}
