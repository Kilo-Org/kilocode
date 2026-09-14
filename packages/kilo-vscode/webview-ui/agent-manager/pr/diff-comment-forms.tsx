import { getOwner, runWithOwner, type Accessor } from "solid-js"
import { render as mount } from "solid-js/web"
import { PRCommentForm } from "./PRCommentForm"
import { useVSCode } from "../../src/context/vscode"
import { extractLines } from "../../diff-viewer/review-comments"
import { createCommentsGithub, resolveGithubContext } from "../../diff-viewer/comments-github"
import { parsePatch } from "../../../src/shared/pr-patch"
import type { AnnotationMeta, CommentFormMount } from "../../diff-viewer/review-annotations"
import type { WorktreeFileDiff } from "../../src/types/messages"
import type { PRDiffSnapshot, PRTarget } from "../../../src/shared/pr-comment-actions"

interface Options {
  target: Accessor<PRTarget | undefined>
  snapshot: Accessor<PRDiffSnapshot | undefined>
  diffs: Accessor<WorktreeFileDiff[]>
  worktree: Accessor<string>
  /** Gate GitHub publication, for example when only a local diff source is shown. */
  canPublish?: Accessor<boolean>
}

function side(value: AnnotationMeta["side"]): "LEFT" | "RIGHT" {
  return value === "deletions" ? "LEFT" : "RIGHT"
}

export function createDiffCommentForms(opts: Options) {
  const owner = getOwner()
  const vscode = useVSCode()
  const github = createCommentsGithub({
    target: opts.target,
    snapshot: opts.snapshot,
    diffs: opts.diffs,
    post: vscode.postMessage,
    canPublish: opts.canPublish,
  })

  const mountDraft: CommentFormMount = (host, meta, actions) => {
    const diff = opts.diffs().find((item) => item.file === meta.file)
    const content = meta.side === "deletions" ? (diff?.before ?? "") : (diff?.after ?? "")
    const end = meta.endLine ?? meta.line
    const selected =
      (diff?.patch
        ? parsePatch(diff.patch, undefined, { side: side(meta.side), start: meta.line, end })?.source
        : undefined) ?? extractLines(content, meta.line, end)
    const context = () => {
      if (opts.canPublish?.() === false) return
      return resolveGithubContext({
        target: opts.target(),
        snapshot: opts.snapshot(),
        file: meta.file,
        side: meta.side,
        start: meta.line,
        end,
        patch: diff?.patch,
      })
    }
    const attach = () =>
      mount(
        () => (
          <PRCommentForm
            inline
            action="diff"
            worktreeId={opts.worktree()}
            projectId={opts.target()?.projectId}
            file={meta.file}
            side={side(meta.side)}
            startLine={meta.line}
            endLine={end}
            selectedText={selected}
            destination={context() && meta.destination === "github" ? "github" : "local"}
            github={context()}
            initialBody={actions.body}
            onBodyChange={actions.onBodyChange}
            onDestinationChange={actions.onDestination}
            onSave={actions.onSave}
            onSendKilo={actions.onSend}
            onGithubSuccess={actions.onGithubSuccess}
            onCancel={actions.onCancel}
          />
        ),
        host,
      )
    return owner ? runWithOwner(owner, attach) : attach()
  }

  return { mount: mountDraft, github }
}
