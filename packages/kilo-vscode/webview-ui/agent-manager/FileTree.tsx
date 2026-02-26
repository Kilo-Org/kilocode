import { type Component, createSignal, createMemo, For, Show } from "solid-js"
import { FileIcon } from "@kilocode/kilo-ui/file-icon"
import { Icon } from "@kilocode/kilo-ui/icon"
import type { WorktreeFileDiff } from "../src/types/messages"
import { useLanguage } from "../src/context/language"
import { buildFileTree, flatten, type FileTreeNode } from "./file-tree-utils"

export type { FileTreeNode } from "./file-tree-utils"
export { buildFileTree, flatten, flattenChain } from "./file-tree-utils"

interface FileTreeProps {
  diffs: WorktreeFileDiff[]
  activeFile: string | null
  onFileSelect: (path: string) => void
}

const DirectoryNode: Component<{
  node: FileTreeNode
  activeFile: string | null
  onFileSelect: (path: string) => void
  depth: number
}> = (props) => {
  const [expanded, setExpanded] = createSignal(true)
  const hasActiveDescendant = createMemo(() => {
    if (!props.activeFile) return false
    return props.activeFile.startsWith(props.node.path + "/")
  })

  return (
    <div class="am-file-tree-group">
      <button
        class={`am-file-tree-dir ${hasActiveDescendant() ? "am-file-tree-dir-highlight" : ""}`}
        style={{ "padding-left": `${8 + props.depth * 12}px` }}
        onClick={() => setExpanded((p) => !p)}
      >
        <Icon name={expanded() ? "chevron-down" : "chevron-right"} size="small" />
        <Icon name="folder" size="small" />
        <span class="am-file-tree-name">{props.node.name}</span>
      </button>
      <Show when={expanded()}>
        <For each={props.node.children ?? []}>
          {(child) => (
            <Show
              when={child.children}
              fallback={
                <FileNode
                  node={child}
                  activeFile={props.activeFile}
                  onFileSelect={props.onFileSelect}
                  depth={props.depth + 1}
                />
              }
            >
              <DirectoryNode
                node={child}
                activeFile={props.activeFile}
                onFileSelect={props.onFileSelect}
                depth={props.depth + 1}
              />
            </Show>
          )}
        </For>
      </Show>
    </div>
  )
}

const FileNode: Component<{
  node: FileTreeNode
  activeFile: string | null
  onFileSelect: (path: string) => void
  depth: number
}> = (props) => {
  const active = () => props.activeFile === props.node.path
  const status = () => props.node.diff?.status ?? "modified"

  return (
    <button
      class={`am-file-tree-file ${active() ? "am-file-tree-active" : ""}`}
      classList={{
        "am-file-tree-status-added": status() === "added",
        "am-file-tree-status-deleted": status() === "deleted",
        "am-file-tree-status-modified": status() === "modified",
      }}
      style={{ "padding-left": `${8 + props.depth * 12}px` }}
      onClick={() => props.onFileSelect(props.node.path)}
    >
      <FileIcon node={{ path: props.node.path, type: "file" }} />
      <span class="am-file-tree-name">{props.node.name}</span>
      <Show when={props.node.diff}>
        {(diff) => (
          <span class="am-file-tree-changes">
            <Show when={diff().status === "added"}>
              <span class="am-file-tree-badge-added">A</span>
            </Show>
            <Show when={diff().status === "deleted"}>
              <span class="am-file-tree-badge-deleted">D</span>
            </Show>
            <Show when={diff().status !== "added" && diff().status !== "deleted"}>
              <span class="am-file-tree-stat-add">+{diff().additions}</span>
              <span class="am-file-tree-stat-del">-{diff().deletions}</span>
            </Show>
          </span>
        )}
      </Show>
    </button>
  )
}

export const FileTree: Component<FileTreeProps> = (props) => {
  const { t } = useLanguage()
  const tree = createMemo(() => flatten(buildFileTree(props.diffs)))
  const totals = createMemo(() => {
    const adds = props.diffs.reduce((s, d) => s + d.additions, 0)
    const dels = props.diffs.reduce((s, d) => s + d.deletions, 0)
    return { files: props.diffs.length, additions: adds, deletions: dels }
  })

  return (
    <div class="am-file-tree">
      <div class="am-file-tree-list">
        <For each={tree()}>
          {(node) => (
            <Show
              when={node.children}
              fallback={
                <FileNode node={node} activeFile={props.activeFile} onFileSelect={props.onFileSelect} depth={0} />
              }
            >
              <DirectoryNode node={node} activeFile={props.activeFile} onFileSelect={props.onFileSelect} depth={0} />
            </Show>
          )}
        </For>
      </div>
      <div class="am-file-tree-summary">
        <span>{t("session.review.filesChanged", { count: totals().files })}</span>
        <span class="am-file-tree-summary-adds">+{totals().additions}</span>
        <span class="am-file-tree-summary-dels">-{totals().deletions}</span>
      </div>
    </div>
  )
}
