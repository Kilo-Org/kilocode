/** @jsxImportSource solid-js */
import { Icon } from "@kilocode/kilo-ui/icon"
import { useLanguage } from "../../src/context/language"
import { PRCommentMarkdown } from "./PRCommentMarkdown"
import { PRCommentTime } from "./PRCommentTime"

/**
 * Opening card of the PR conversation, like the first post of the GitHub
 * timeline. The body is the current description, not a historical snapshot.
 */
export function PRDescription(props: { body: string; author?: string; createdAt?: number }) {
  const { t } = useLanguage()
  return (
    <div class="am-pr-comment am-pr-comment-open am-pr-timeline-description" data-thread-id="pr-description">
      <div class="am-pr-comment-head am-pr-row">
        <Icon name="pull-request" size="small" class="am-pr-comment-check" />
        <span class="am-pr-comment-author">{props.author ?? "unknown"}</span>
        <span class="am-pr-comment-preview">{t("agentManager.pr.timeline.opened")}</span>
        <div class="am-pr-comment-tags">
          <PRCommentTime time={props.createdAt} />
        </div>
      </div>
      <div class="am-pr-comment-body">
        <PRCommentMarkdown text={props.body} />
      </div>
    </div>
  )
}
