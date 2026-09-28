import { Show } from "solid-js"
import type { PRTarget } from "../../../src/shared/pr-comment-actions"
import { PRCommentForm } from "./PRCommentForm"
import { PRCommentMarkdown } from "./PRCommentMarkdown"

export function PRCommentBody(props: {
  comment: { id?: string; body: string; canEdit?: boolean; canDelete?: boolean }
  target?: PRTarget
  suggestion?: boolean
  published?: PRTarget
}) {
  return (
    <Show
      when={props.target && props.comment.id && (props.comment.canEdit || props.comment.canDelete)}
      fallback={
        <div class="am-pr-comment-body">
          <PRCommentMarkdown
            text={props.comment.body}
            published={
              props.published && props.comment.id ? { ...props.published, commentId: props.comment.id } : undefined
            }
          />
        </div>
      }
    >
      <PRCommentForm
        action="edit"
        {...props.target!}
        commentId={props.comment.id!}
        body={props.comment.body}
        canEdit={props.comment.canEdit}
        canDelete={props.comment.canDelete}
        suggestion={props.suggestion}
        published={props.published}
      />
    </Show>
  )
}
