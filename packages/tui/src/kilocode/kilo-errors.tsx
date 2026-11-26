import { KiloGatewayError, type KiloActionErrorCode } from "@opencode/util/kilocode/gateway-errors"
import { SplitBorder } from "../ui/border"
import { useTheme } from "../context/theme"

export const parseKiloErrorCode = KiloGatewayError.parseCode
export const kiloErrorTitle = KiloGatewayError.title
export const kiloErrorDescription = KiloGatewayError.description

export function KiloErrorBlock(props: { code: KiloActionErrorCode }) {
  const theme = useTheme()
  return (
    <box
      marginLeft={2}
      border={["left"]}
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={2}
      marginTop={1}
      backgroundColor={theme.background.raised.base}
      customBorderChars={SplitBorder.customBorderChars}
      borderColor={theme.text.feedback.warning.base}
    >
      <text fg={theme.text.base}>{KiloGatewayError.title(props.code)}</text>
      <text fg={theme.text.muted} wrapMode="word">
        {KiloGatewayError.description(props.code)}
      </text>
      <text fg={theme.text.feedback.warning.base}>
        {"Run /connect or `kilo auth login` to connect to Kilo Gateway"}
      </text>
    </box>
  )
}
