import type { KiloHostedRpc } from "@opencode/schema/kilocode/hosted"
import { Icon } from "@kilocode/kilo-ui/icon"
import { For } from "solid-js"
import { useLanguage } from "../../src/context/language"

export function PreparationProgress(props: { progress: KiloHostedRpc.Progress }) {
  const { t } = useLanguage()
  const stage = (step: string) => step.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase())
  const current = () =>
    props.progress.steps.find((s) => s.status === "failed") ?? props.progress.steps.find((s) => s.status === "running")
  const failed = () => props.progress.phase === "error" || props.progress.preparation === "failed"
  return (
    <details class="am-cloud-preparation" data-phase={props.progress.phase}>
      <summary>
        <Icon name={failed() ? "warning" : props.progress.phase === "ready" ? "check" : "server"} size="small" />{" "}
        {t("settings.sandboxing.enabled.title")} ·{" "}
        {failed()
          ? t("task.backgroundAgents.status.error")
          : stage(current()?.step ?? props.progress.sandbox ?? props.progress.phase ?? "preparing")}
      </summary>
      <ol>
        <For each={props.progress.steps}>
          {(s) => (
            <li data-status={s.status}>
              <Icon
                name={s.status === "completed" ? "check" : s.status === "failed" ? "warning" : "clock"}
                size="small"
              />{" "}
              {stage(s.step)}
            </li>
          )}
        </For>
      </ol>
    </details>
  )
}
