import { useLanguage } from "../src/context/language"
import { createDiffCommentForms } from "../agent-manager/pr/diff-comment-forms"
import { createReviewView, type ReviewViewProps } from "./review-controller"
import { notice, reviewSendAllKeybind } from "./review-setup"
import type { PRDiffSnapshot, PRTarget } from "../../src/shared/pr-comment-actions"

interface SurfaceProps extends ReviewViewProps {
  notice?: string
  sessionId?: string
  prTarget?: PRTarget
  prSnapshot?: PRDiffSnapshot
}

/** Shared wiring for the inline and full-screen diff review surfaces. */
export function createReviewSurface(props: SurfaceProps, root: () => HTMLDivElement | undefined) {
  const { t } = useLanguage()
  const forms = createDiffCommentForms({
    target: () => props.prTarget,
    snapshot: () => props.prSnapshot,
    diffs: () => props.diffs,
    worktree: () => props.worktreeId ?? props.sessionId ?? "diff",
  })
  const view = createReviewView(props, root, {
    commentForm: props.commentForm ?? forms.mount,
    commentsGithub: props.commentsGithub ?? forms.github,
  })
  return {
    t,
    noticeText: () => notice(t, props.notice),
    sendAllKeybind: () => reviewSendAllKeybind(t),
    ...view,
  }
}
