/** @jsxImportSource @opentui/solid */

import { createMemo, Match, Show, Switch, type JSX } from "solid-js"
import { useTheme } from "../../../cli/cmd/tui/context/theme"
import type { SuggestionRequest, ToolPart as MessageToolPart } from "@kilocode/sdk/v2"
import { SuggestBar } from "./bar"

type InlineProps = {
  icon: string
  complete: unknown
  pending: string
  part: MessageToolPart
  children: JSX.Element
}

type BlockProps = {
  title: string
  part?: MessageToolPart
  children: JSX.Element
}

export function Suggest(props: {
  input: {
    suggest?: string
  }
  metadata: {
    accepted?: {
      label: string
    }
    dismissed?: boolean
  }
  part: MessageToolPart
  InlineTool: (props: InlineProps) => JSX.Element
  BlockTool: (props: BlockProps) => JSX.Element
  pendingRequest?: SuggestionRequest
}) {
  const { theme } = useTheme()
  const accepted = createMemo(() => props.metadata.accepted)
  const dismissed = createMemo(() => props.metadata.dismissed === true)
  const resolved = createMemo(() => Boolean(accepted() || dismissed()))

  return (
    <Switch>
      <Match when={resolved()}>
        {(_) =>
          props.BlockTool({
            title: "# Suggestion",
            part: props.part,
            children: (
              <box gap={1}>
                <text fg={theme.textMuted}>{props.input.suggest}</text>
                <Show when={accepted()}>
                  <text fg={theme.text}>Accepted: {accepted()?.label}</text>
                </Show>
                <Show when={dismissed()}>
                  <text fg={theme.text}>Dismissed</text>
                </Show>
              </box>
            ),
          })
        }
      </Match>
      <Match when={props.pendingRequest} keyed>
        {(request) => <SuggestBar request={request} />}
      </Match>
      <Match when={true}>
        {(_) =>
          props.InlineTool({
            icon: "→",
            pending: "Suggesting next step...",
            complete: props.part.state.status === "completed",
            part: props.part,
            children: props.input.suggest ?? "Suggested next step",
          })
        }
      </Match>
    </Switch>
  )
}
