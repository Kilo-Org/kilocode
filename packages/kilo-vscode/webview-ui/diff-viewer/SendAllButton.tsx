import { Show, type Component } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { Tooltip, TooltipKeybind } from "@kilocode/kilo-ui/tooltip"
import { useLanguage } from "../src/context/language"

interface Props {
  /** Number of local comments. */
  count: number
  /** Number of local comments that can be posted to the PR. */
  githubCount: number
  /** PR number when a publishable PR is available. */
  githubNumber?: number
  pending: boolean
  onSendChat: () => void
  onSendGithub: () => void
  keybind: string
  placement?: "top" | "bottom"
}

/**
 * Send-all actions for the review toolbars.
 *
 * Without a publishable PR it is the plain send-to-chat button. With a PR it
 * shows two explicit buttons. Only the chat button advertises the keyboard
 * shortcut, so only it can send everything through the keyboard.
 */
export const SendAllButton: Component<Props> = (props) => {
  const { t } = useLanguage()
  const placement = () => props.placement ?? "top"
  const github = () => props.githubNumber
  const chatLabel = () => t("agentManager.review.sendAllToChatWithCount", { count: props.count })
  const githubLabel = () =>
    t("agentManager.review.sendAllToGithubWithCount", { count: props.githubCount, number: github() ?? 0 })
  const Chat = () => (
    <TooltipKeybind title={t("agentManager.review.sendAllToChat")} keybind={props.keybind} placement={placement()}>
      <Button
        data-action="send-all-chat"
        variant="primary"
        size="small"
        disabled={props.pending}
        onClick={props.onSendChat}
      >
        {chatLabel()}
      </Button>
    </TooltipKeybind>
  )
  return (
    <Show when={github() !== undefined} fallback={<Chat />}>
      <div class="am-send-all-actions">
        <Chat />
        <Tooltip value={githubLabel()} placement={placement()}>
          <Button
            data-action="send-all-github"
            variant="secondary"
            size="small"
            disabled={props.pending || props.githubCount === 0}
            aria-busy={props.pending}
            onClick={props.onSendGithub}
          >
            <Show when={props.pending}>
              <Spinner />
            </Show>
            {githubLabel()}
          </Button>
        </Tooltip>
      </div>
    </Show>
  )
}
