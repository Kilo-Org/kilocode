import { Card } from "@kilocode/kilo-ui/card"
import { type Component, Show } from "solid-js"
import { useLanguage } from "../../context/language"
import { useSession } from "../../context/session"

export const CloudMessageFailureIndicator: Component = () => {
  const language = useLanguage()
  const session = useSession()

  return (
    <Show when={session.cloudMessageFailure()}>
      {(failure) => (
        <div class="vscode-session-turn" role="alert">
          <Card variant="error">
            {language.t(
              failure().status === "interrupted"
                ? "agentManager.cloud.message.interrupted"
                : "agentManager.cloud.message.failed",
            )}
          </Card>
        </div>
      )}
    </Show>
  )
}
