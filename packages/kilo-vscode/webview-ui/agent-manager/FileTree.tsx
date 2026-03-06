import { type Component, createSignal, createMemo, For, Show } from "solid-js"
import { FileIcon } from "@kilocode/kilo-ui/file-icon"
import { Icon } from "@kilocode/kilo-ui/icon"
import type { WorktreeFileDiff, GeneratedSummary } from "../src/types/messages"
import { useLanguage } from "../src/context/language"
import { buildFileTree, flatten, type FileTreeNode } from "./file-tree-utils"
import type { ReviewComment } from "./review-comments"

export type { FileTreeNode } from "./file-tree-utils"
export { buildFileTree, flatten, flattenChain } from "./file-tree-utils"

interface FileTreeProps {
  diffs: WorktreeFileDiff[]
  generated?: GeneratedSummary
  activeFile: string | null
  onFileSelect: (path: string) => void
  comments?: ReviewComment[]
  selectedFiles?: Set<string>
  onFileToggle?: (path: string, checked: boolean) => void
  showSummary?: boolean
}

interface GeneratedFolderGroup {
  folder: string
  files: number
  additions: number
  deletions: number
}

// Find the generated folder prefix for grouping. For "packages/app/node_modules/react/index.js"
// this returns "packages/app/node_modules" — the path up to and including the generated folder segment.
function generatedPrefix(filepath: string): string {
  const segments = filepath.split("/")
  // Walk segments to find the first that looks like a generated/vendor directory.
  // These are the most common names from our GENERATED_FOLDERS set — just enough
  // to group correctly in the UI without importing the full server-side set.
  const known = new Set([
    "node_modules",
    "bower_components",
    ".pnpm-store",
    ".yarn",
    "vendor",
    "Pods",
    "dist",
    "build",
    "out",
    ".next",
    ".nuxt",
    ".output",
    ".svelte-kit",
    "target",
    "obj",
    ".turbo",
    ".cache",
    ".parcel-cache",
    "__pycache__",
    ".pytest_cache",
    ".gradle",
    ".terraform",
    "coverage",
    ".venv",
    "venv",
  ])
  for (let i = 0; i < segments.length; i++) {
    if (known.has(segments[i]!)) return segments.slice(0, i + 1).join("/")
  }
  // Fallback: use first segment
  return segments[0] ?? filepath
}

function groupGeneratedByFolder(generated: GeneratedSummary): GeneratedFolderGroup[] {
  const groups = new Map<string, { files: number; additions: number; deletions: number }>()
  for (const entry of generated.entries) {
    const folder = generatedPrefix(entry.file)
    const existing = groups.get(folder) ?? { files: 0, additions: 0, deletions: 0 }
    existing.files++
    existing.additions += entry.additions
    existing.deletions += entry.deletions
    groups.set(folder, existing)
  }
  return Array.from(groups.entries())
    .map(([folder, stats]) => ({ folder, ...stats }))
    .sort((a, b) => b.files - a.files)
}

const DirectoryNode: Component<{
  node: FileTreeNode
  activeFile: string | null
  onFileSelect: (path: string) => void
  depth: number
  commentsByFile?: Map<string, number>
  selectedFiles?: Set<string>
  onFileToggle?: (path: string, checked: boolean) => void
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
                  commentsByFile={props.commentsByFile}
                  selectedFiles={props.selectedFiles}
                  onFileToggle={props.onFileToggle}
                />
              }
            >
              <DirectoryNode
                node={child}
                activeFile={props.activeFile}
                onFileSelect={props.onFileSelect}
                depth={props.depth + 1}
                commentsByFile={props.commentsByFile}
                selectedFiles={props.selectedFiles}
                onFileToggle={props.onFileToggle}
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
  commentsByFile?: Map<string, number>
  selectedFiles?: Set<string>
  onFileToggle?: (path: string, checked: boolean) => void
}> = (props) => {
  const active = () => props.activeFile === props.node.path
  const checked = () => props.selectedFiles?.has(props.node.path) ?? false
  const selectable = () => Boolean(props.onFileToggle)
  const status = () => props.node.diff?.status ?? "modified"
  const additions = () => props.node.diff?.additions ?? 0
  const deletions = () => props.node.diff?.deletions ?? 0
  const showAdd = () => additions() > 0 || status() === "added"
  const showDel = () => deletions() > 0 || status() === "deleted"
  const comments = () => props.commentsByFile?.get(props.node.path) ?? 0

  return (
    <button
      class={`am-file-tree-file ${active() ? "am-file-tree-active" : ""}`}
      classList={{
        "am-file-tree-selected": selectable() && checked(),
        "am-file-tree-status-added": status() === "added",
        "am-file-tree-status-deleted": status() === "deleted",
        "am-file-tree-status-modified": status() === "modified",
      }}
      style={{ "padding-left": `${8 + props.depth * 12}px` }}
      onClick={() => {
        if (props.onFileToggle) {
          props.onFileToggle(props.node.path, !checked())
          return
        }
        props.onFileSelect(props.node.path)
      }}
    >
      <Show when={selectable()}>
        <span class={`am-file-tree-check ${checked() ? "am-file-tree-check-on" : ""}`}>
          <Show when={checked()}>
            <Icon name="check" size="small" />
          </Show>
        </span>
      </Show>
      <FileIcon node={{ path: props.node.path, type: "file" }} />
      <span class="am-file-tree-name">{props.node.name}</span>
      <Show when={comments() > 0}>
        <span class="am-file-tree-comment-badge">{comments()}</span>
      </Show>
      <Show when={props.node.diff}>
        {(diff) => (
          <span class="am-file-tree-changes">
            <Show when={diff().status === "added"}>
              <span class="am-file-tree-badge-added">A</span>
            </Show>
            <Show when={diff().status === "deleted"}>
              <span class="am-file-tree-badge-deleted">D</span>
            </Show>
            <Show when={showAdd()}>
              <span class="am-file-tree-stat-add">+{additions()}</span>
            </Show>
            <Show when={showDel()}>
              <span class="am-file-tree-stat-del">-{deletions()}</span>
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
  const commentsByFile = createMemo(() => {
    const map = new Map<string, number>()
    for (const comment of props.comments ?? []) {
      map.set(comment.file, (map.get(comment.file) ?? 0) + 1)
    }
    return map
  })
  const totals = createMemo(() => {
    const adds = props.diffs.reduce((s, d) => s + d.additions, 0)
    const dels = props.diffs.reduce((s, d) => s + d.deletions, 0)
    return { files: props.diffs.length, additions: adds, deletions: dels }
  })
  const generatedGroups = createMemo(() => {
    const gen = props.generated
    if (!gen || gen.files === 0) return []
    return groupGeneratedByFolder(gen)
  })

  return (
    <div class="am-file-tree">
      <div class="am-file-tree-list">
        <For each={tree()}>
          {(node) => (
            <Show
              when={node.children}
              fallback={
                <FileNode
                  node={node}
                  activeFile={props.activeFile}
                  onFileSelect={props.onFileSelect}
                  depth={0}
                  commentsByFile={commentsByFile()}
                  selectedFiles={props.selectedFiles}
                  onFileToggle={props.onFileToggle}
                />
              }
            >
              <DirectoryNode
                node={node}
                activeFile={props.activeFile}
                onFileSelect={props.onFileSelect}
                depth={0}
                commentsByFile={commentsByFile()}
                selectedFiles={props.selectedFiles}
                onFileToggle={props.onFileToggle}
              />
            </Show>
          )}
        </For>
        <Show when={generatedGroups().length > 0}>
          <div class="am-file-tree-generated-divider" />
          <For each={generatedGroups()}>
            {(group) => (
              <div class="am-file-tree-generated-row" style={{ "padding-left": "8px" }}>
                <Icon name="folder" size="small" />
                <span class="am-file-tree-name">{group.folder}/</span>
                <span class="am-file-tree-generated-stats">
                  <span class="am-file-tree-generated-count">{group.files}</span>
                </span>
              </div>
            )}
          </For>
        </Show>
      </div>
      <Show when={props.showSummary !== false}>
        <div class="am-file-tree-summary">
          <span>{t("session.review.filesChanged", { count: totals().files })}</span>
          <span class="am-file-tree-summary-adds">+{totals().additions}</span>
          <span class="am-file-tree-summary-dels">-{totals().deletions}</span>
        </div>
      </Show>
    </div>
  )
}
