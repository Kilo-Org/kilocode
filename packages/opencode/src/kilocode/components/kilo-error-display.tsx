import { createMemo, Match, Switch, type JSX } from "solid-js"
import { SplitBorder } from "@tui/component/border"
import { useTheme } from "@tui/context/theme"
import { parseKiloErrorCode, kiloErrorTitle, kiloErrorDescription } from "@/kilocode/kilo-errors"
import type { AssistantMessage } from "@kilocode/sdk/v2"

interface KiloErrorBlockProps {
  error: NonNullable<AssistantMessage["error"]>
  fallback: JSX.Element
}

export function KiloErrorBlock(props: KiloErrorBlockProps) {
  const { theme } = useTheme()

  const kiloErrorCode = createMemo(() => {
    return parseKiloErrorCode(props.error)
  })

  const title = createMemo(() => {
    const code = kiloErrorCode()
    return code ? kiloErrorTitle(code) : undefined
  })

  const description = createMemo(() => {
    const code = kiloErrorCode()
    return code ? kiloErrorDescription(code) : undefined
  })

  return (
    <Switch fallback={props.fallback}>
      <Match when={kiloErrorCode()}>
        <box
          border={["left"]}
          paddingTop={1}
          paddingBottom={1}
          paddingLeft={2}
          marginTop={1}
          backgroundColor={theme.backgroundPanel}
          customBorderChars={SplitBorder.customBorderChars}
          borderColor={theme.primary}
        >
          <text fg={theme.text}>{title()}</text>
          <text fg={theme.textMuted}>{description()}</text>
          <text fg={theme.primary}>{"Run /connect or `kilo auth login` to connect to Kilo Gateway"}</text>
        </box>
      </Match>
    </Switch>
  )
}
