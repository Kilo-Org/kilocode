// The `@` mention dropdown of the v2 composer: the ranked menu, and the past-chat and worktree pickers it opens.
import { FileIcon } from "@kilocode/kilo-ui/file-icon"
import { Icon } from "@kilocode/kilo-ui/icon"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { For, Show } from "solid-js"
import { dirName, fileName } from "../components/chat/prompt-input-utils"
import { SessionMentionPicker } from "../components/chat/SessionMentionPicker"
import { WorktreeMentionPicker } from "../components/chat/WorktreeMentionPicker"
import { useLanguage } from "../context/language"
import { isMentionEntry, type MentionResult } from "../hooks/file-mention-utils"
import type { FileMention } from "../hooks/useFileMention"
import type { SessionSearchItem, WorktreeReference } from "../utils/prompt-mention-drop"
import { formatRelativeDate } from "../utils/date"

function MentionItemContent(props: { item: MentionResult }) {
  const item = props.item
  const language = useLanguage()
  if (item.type === "terminal")
    return (
      <>
        <Icon name="console" class="file-mention-icon" />
        <span class="file-mention-name">{item.label}</span>
        <span class="file-mention-dir">{item.description}</span>
      </>
    )
  if (item.type === "git-changes" || item.type === "worktrees")
    return (
      <>
        <Icon name="branch" class="file-mention-icon" />
        <span class="file-mention-name">
          {item.type === "worktrees" ? language.t("prompt.worktrees.title") : item.label}
        </span>
        <span class="file-mention-dir">
          {item.type === "worktrees" ? language.t("prompt.worktrees.search") : item.description}
        </span>
      </>
    )
  if (item.type === "past-chats")
    return (
      <>
        <Icon name="history" class="file-mention-icon" />
        <span class="file-mention-name">{item.label}</span>
        <span class="file-mention-dir">{item.description}</span>
      </>
    )
  if (item.type === "model")
    return (
      <>
        <Icon name="models" class="file-mention-icon" />
        <span class="file-mention-name">{item.label}</span>
        <span class="file-mention-dir">{item.description}</span>
      </>
    )
  if (item.type === "session")
    return (
      <>
        <Icon name="history" class="file-mention-icon" />
        <span class="file-mention-name">{item.session.title}</span>
        <span class="file-mention-dir">
          {item.session.worktreeName ?? formatRelativeDate(new Date(item.session.updated).toISOString())}
        </span>
      </>
    )
  if (item.type === "file-picker")
    return (
      <>
        <Icon name="folder" class="file-mention-icon" />
        <span class="file-mention-name">{item.label}</span>
        <span class="file-mention-dir">{item.description}</span>
      </>
    )
  return (
    <>
      <FileIcon
        node={{ path: item.value, type: item.type === "folder" ? "directory" : "file" }}
        class="file-mention-icon"
      />
      <span class="file-mention-name">
        {item.type === "folder" ? `${fileName(item.value)}/` : fileName(item.value)}
      </span>
      {/* Without the folder name, two roots holding the same relative path render identically. */}
      <Show when={item.root}>{(root) => <span class="file-mention-root">{root()}</span>}</Show>
      {/* Shown relative to its own folder: the badge already names the folder, and
          the absolute form would spell out the local filesystem layout instead. */}
      <span class="file-mention-dir">{dirName(item.relative ?? item.value)}</span>
    </>
  )
}

export function MentionMenu(props: {
  mention: FileMention
  ref: (el: HTMLDivElement) => void
  onSelect: (item: MentionResult) => void
  onSession: (session: SessionSearchItem) => void
  onWorktree: (worktree: WorktreeReference) => void
  onClose: () => void
}) {
  const language = useLanguage()
  /**
   * True after the last menu entry of a bare `@`, which lists the entries above
   * the files. A query ranks entries among the results it finds, so there is no
   * group boundary left to draw.
   */
  const divides = (index: number) => {
    if (props.mention.mentionQuery()) return false
    const items = props.mention.mentionResults()
    const item = items.at(index)
    const next = items.at(index + 1)
    return item !== undefined && next !== undefined && isMentionEntry(item) && !isMentionEntry(next)
  }
  return (
    <div class="file-mention-dropdown" ref={props.ref}>
      <Show
        when={!props.mention.sessionPicker()}
        fallback={
          <SessionMentionPicker
            sessions={props.mention.sessionCandidates()}
            onSelect={props.onSession}
            onClose={props.onClose}
          />
        }
      >
        <Show
          when={!props.mention.worktreePicker() && props.mention.mentionResults().length > 0}
          fallback={
            <Show
              when={props.mention.worktreePicker()}
              fallback={<div class="file-mention-empty">{language.t("prompt.mention.empty")}</div>}
            >
              <WorktreeMentionPicker
                worktrees={props.mention.worktreeCandidates()}
                onSelect={props.onWorktree}
                onClose={props.onClose}
              />
            </Show>
          }
        >
          <For each={props.mention.mentionResults()}>
            {(item, index) => (
              <>
                {/* Rendered in the webview rather than as a native `title`, which
                    macOS does not reliably show inside VS Code webviews. */}
                <Tooltip
                  value={
                    item.type === "file" || item.type === "folder" || item.type === "opened-file"
                      ? item.value
                      : undefined
                  }
                  placement="top-start"
                  contentClass="file-mention-tooltip"
                >
                  <div
                    class="file-mention-item"
                    data-type={item.type}
                    classList={{ "file-mention-item--active": index() === props.mention.mentionIndex() }}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      props.onSelect(item)
                    }}
                    onMouseEnter={() => props.mention.setMentionIndex(index())}
                  >
                    <MentionItemContent item={item} />
                  </div>
                </Tooltip>
                <Show when={divides(index())}>
                  <div class="file-mention-separator" />
                </Show>
              </>
            )}
          </For>
        </Show>
      </Show>
    </div>
  )
}
