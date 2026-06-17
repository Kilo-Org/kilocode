import { createMemo, createSignal, For, Match, Show, Switch, type JSX } from "solid-js"
import { Accordion } from "@kilocode/kilo-ui/accordion"
import { Button } from "@kilocode/kilo-ui/button"
import { DiffChanges } from "@kilocode/kilo-ui/diff-changes"
import { FileIcon } from "@kilocode/kilo-ui/file-icon"
import { Icon } from "@kilocode/kilo-ui/icon"
import { RadioGroup } from "@kilocode/kilo-ui/radio-group"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { StickyAccordionHeader } from "@kilocode/kilo-ui/sticky-accordion-header"
import { useI18n } from "@kilocode/kilo-ui/context/i18n"
import { normalize } from "@kilocode/kilo-ui/session-diff"
import type { SessionReviewProps } from "@opencode-ai/ui/session-review"
import { Diff } from "./diff"
import { ScrollView } from "./scroll-view"

export * from "@opencode-ai/ui/session-review"

const EXTREME_DIFF_CHANGED_LINES = 2_000

type DiffInput = Parameters<typeof normalize>[0]
type Raw = SessionReviewProps["diffs"][number] & {
  file?: string
  summarized?: boolean
  tracked?: boolean
  generatedLike?: boolean
}

type Item = ReturnType<typeof normalize> & {
  summarized: boolean
  tracked?: boolean
  generatedLike?: boolean
  ready: boolean
  patchBacked: boolean
}
type ScrollEvent = Event & { currentTarget: HTMLDivElement; target: Element }

function file(value: unknown): value is Raw & { file: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  if (!("file" in value) || typeof value.file !== "string") return false
  if (!("additions" in value) || typeof value.additions !== "number") return false
  if (!("deletions" in value) || typeof value.deletions !== "number") return false
  return true
}

function list(value: SessionReviewProps["diffs"]) {
  return value.filter(file)
}

function dir(path: string) {
  const index = path.lastIndexOf("/")
  if (index < 0) return ""
  return path.slice(0, index)
}

function name(path: string) {
  const index = path.lastIndexOf("/")
  if (index < 0) return path
  return path.slice(index + 1)
}

function content(diff: Raw) {
  if (diff.summarized === true) return false
  if (typeof diff.patch === "string" && diff.patch.length > 0) return true
  if (text(diff, "before").length > 0) return true
  if (text(diff, "after").length > 0) return true
  return false
}

function text(diff: Raw, key: "before" | "after") {
  const value = (diff as Record<string, unknown>)[key]
  if (typeof value === "string") return value
  return ""
}

function virtualized(diff: Item) {
  return !diff.patchBacked || diff.additions + diff.deletions > EXTREME_DIFF_CHANGED_LINES
}

function call(handler: SessionReviewProps["onScroll"], event: ScrollEvent) {
  if (!handler) return
  if (Array.isArray(handler)) {
    const [fn, data] = handler as [(data: unknown, event: Event) => void, unknown]
    fn(data, event)
    return
  }
  ;(handler as JSX.EventHandler<HTMLDivElement, Event>)(event)
}

export function SessionReview(props: SessionReviewProps) {
  const i18n = useI18n()
  const [stored, setStored] = createSignal<string[]>([])

  const open = () => props.open ?? stored()
  const items = createMemo<Item[]>(() =>
    list(props.diffs).map((raw) => {
      const view = normalize(raw as DiffInput)
      return {
        ...view,
        summarized: raw.summarized === true,
        tracked: raw.tracked,
        generatedLike: raw.generatedLike,
        ready: content(raw),
        patchBacked: typeof raw.patch === "string" && raw.patch.length > 0,
      }
    }),
  )
  const files = createMemo(() => items().map((diff) => diff.file))
  const hasDiffs = () => items().length > 0
  const style = () => props.diffStyle ?? (props.split ? "split" : "unified")

  const change = (next: string[]) => {
    const allowed = new Set(files())
    const value = next.filter((file) => allowed.has(file))
    props.onOpenChange?.(value)
    if (props.open === undefined) setStored(value)
  }

  const toggle = () => {
    const next = open().length > 0 ? [] : files()
    change(next)
  }

  const title = () => (props.title === undefined ? i18n.t("ui.sessionReview.title") : props.title)

  return (
    <div data-component="session-review" class={props.class} classList={props.classList}>
      <div data-slot="session-review-header" class={props.classes?.header}>
        <div data-slot="session-review-title">{title()}</div>
        <div data-slot="session-review-actions">
          <Show when={hasDiffs() && props.onDiffStyleChange}>
            <RadioGroup
              options={["unified", "split"] as const}
              current={style()}
              size="small"
              value={(style) => style}
              label={(style) =>
                i18n.t(style === "unified" ? "ui.sessionReview.diffStyle.unified" : "ui.sessionReview.diffStyle.split")
              }
              onSelect={(style) => style && props.onDiffStyleChange?.(style)}
            />
          </Show>
          <Show when={hasDiffs()}>
            <Button size="small" variant="secondary" icon="chevron-grabber-vertical" onClick={toggle}>
              <Switch>
                <Match when={open().length > 0}>{i18n.t("ui.sessionReview.collapseAll")}</Match>
                <Match when={true}>{i18n.t("ui.sessionReview.expandAll")}</Match>
              </Switch>
            </Button>
          </Show>
          {props.actions}
        </div>
      </div>

      <ScrollView
        data-slot="session-review-scroll"
        viewportRef={props.scrollRef}
        onScroll={(event: ScrollEvent) => call(props.onScroll, event)}
        classList={{
          [props.classes?.root ?? ""]: !!props.classes?.root,
        }}
      >
        <div data-slot="session-review-container" class={props.classes?.container}>
          <Show when={hasDiffs()} fallback={props.empty}>
            <div class="pb-6">
              <Accordion multiple value={open()} onChange={change}>
                <For each={items()}>
                  {(diff) => {
                    const expanded = () => open().includes(diff.file)
                    const expandable = () => diff.additions !== 0 || diff.deletions !== 0
                    const added = () => diff.status === "added" || (diff.before.length === 0 && diff.after.length > 0)
                    const deleted = () =>
                      diff.status === "deleted" || (diff.after.length === 0 && diff.before.length > 0)

                    return (
                      <Accordion.Item
                        value={diff.file}
                        data-slot="session-review-accordion-item"
                        data-file={diff.file}
                        data-selected={props.focusedFile === diff.file ? "" : undefined}
                      >
                        <StickyAccordionHeader>
                          <Accordion.Trigger disabled={!expandable()} class="cursor-default">
                            <div data-slot="session-review-trigger-content">
                              <div data-slot="session-review-file-info">
                                <FileIcon node={{ path: diff.file, type: "file" }} />
                                <div data-slot="session-review-file-name-container">
                                  <Show when={dir(diff.file)}>
                                    <span data-slot="session-review-directory">{`\u2066${dir(diff.file)}\u2069`}</span>
                                  </Show>
                                  <span data-slot="session-review-filename">{name(diff.file)}</span>
                                </div>
                              </div>
                              <div data-slot="session-review-trigger-actions">
                                <Switch>
                                  <Match when={added()}>
                                    <div data-slot="session-review-change-group" data-type="added">
                                      <span data-slot="session-review-change" data-type="added">
                                        {i18n.t("ui.sessionReview.change.added")}
                                      </span>
                                      <DiffChanges changes={diff} />
                                    </div>
                                  </Match>
                                  <Match when={deleted()}>
                                    <span data-slot="session-review-change" data-type="removed">
                                      {i18n.t("ui.sessionReview.change.removed")}
                                    </span>
                                  </Match>
                                  <Match when={true}>
                                    <DiffChanges changes={diff} />
                                  </Match>
                                </Switch>
                                <Show when={expandable()}>
                                  <span data-slot="session-review-diff-chevron">
                                    <Icon name="chevron-down" size="small" />
                                  </span>
                                </Show>
                              </div>
                            </div>
                          </Accordion.Trigger>
                        </StickyAccordionHeader>
                        <Accordion.Content data-slot="session-review-accordion-content">
                          <Show when={expanded()}>
                            <div data-slot="session-review-diff-wrapper">
                              <Show
                                when={diff.ready}
                                fallback={
                                  <div data-slot="session-review-large-diff">
                                    <div data-slot="session-review-large-diff-title" data-state="loading">
                                      <Spinner />
                                      <span>{i18n.t("ui.sessionReview.image.loading")}</span>
                                    </div>
                                  </div>
                                }
                              >
                                <Diff
                                  fileDiff={diff.fileDiff}
                                  diffStyle={style()}
                                  virtualized={virtualized(diff)}
                                  onRendered={props.onDiffRendered}
                                />
                              </Show>
                            </div>
                          </Show>
                        </Accordion.Content>
                      </Accordion.Item>
                    )
                  }}
                </For>
              </Accordion>
            </div>
          </Show>
        </div>
      </ScrollView>
    </div>
  )
}
