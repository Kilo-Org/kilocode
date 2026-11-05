import { onMount } from "solid-js"
import { Card, CardTitle, CardDescription, CardActions } from "@kilocode/kilo-ui/card"
import { Button } from "@kilocode/kilo-ui/button"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { useLanguage } from "../../context/language"
import { useVSCode } from "../../context/vscode"
import { TelemetryEventName } from "../../../../src/services/telemetry/types"

export function AgentManagerUpsell(props: { onDismiss: () => void }) {
  const language = useLanguage()
  const vscode = useVSCode()
  const track = (action: "shown" | "open" | "dismiss") =>
    vscode.postMessage({ type: "telemetry", event: TelemetryEventName.AGENT_MANAGER_UPSELL, properties: { action } })
  const dismiss = (action: "open" | "dismiss") => {
    props.onDismiss()
    vscode.postMessage({ type: "dismissAgentManagerUpsell" })
    track(action)
    if (action === "open") vscode.postMessage({ type: "openAgentManagerUpsell" })
  }
  onMount(() => track("shown"))
  return (
    <Card class="agent-manager-upsell">
      <div class="agent-manager-upsell-heading">
        <CardTitle icon={false}>{language.t("sidebar.upsell.title")}</CardTitle>
        <IconButton
          icon="close"
          variant="ghost"
          aria-label={language.t("sidebar.upsell.dismiss")}
          onClick={() => dismiss("dismiss")}
        />
      </div>
      <CardDescription>{language.t("sidebar.upsell.body")}</CardDescription>
      <CardActions>
        <Button variant="secondary" size="small" onClick={() => dismiss("open")}>
          {language.t("sidebar.upsell.open")}
        </Button>
      </CardActions>
    </Card>
  )
}
