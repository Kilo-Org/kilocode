import { createSignal, For, onCleanup, onMount, Show } from "solid-js"
import type { OpenCodeClient } from "@opencode/client"
import { Button } from "@kilocode/kilo-ui/button"
import { Dialog } from "@kilocode/kilo-ui/dialog"
import type { HostedManagement } from "@opencode/schema/kilocode/hosted-management"
import { useLanguage } from "../../src/context/language"
import type { ChatRoute } from "./route"
import { managementActions, type CloudManagementAction } from "./management-actions"

export type { CloudManagementAction } from "./management-actions"
type Props = {
  api: OpenCodeClient
  route: ChatRoute
  action: CloudManagementAction
  onClose: () => void
  onRenamed: (title: string) => void
  onDeleted: () => void
}

export function CloudManagementDialog(props: Props) {
  const { t } = useLanguage()
  const [title, setTitle] = createSignal(props.route.title)
  const [info, setInfo] = createSignal<HostedManagement.Info>()
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal("")
  const actions = managementActions(props.api, props.route)
  onCleanup(actions.dismiss)
  const label = () =>
    t(
      props.action === "delete"
        ? "session.delete.title"
        : props.action === "info"
          ? "error.details.show"
          : "common.rename",
    )

  async function perform() {
    if (busy()) return
    setBusy(true)
    setError("")
    try {
      if (props.action === "info") {
        setInfo(await actions.info())
        return
      }
      if (props.action === "delete") {
        await actions.confirmDelete()
        props.onDeleted()
      }
      if (props.action === "rename") {
        const ack = await actions.rename(title().trim())
        props.onRenamed(ack.title)
      }
      props.onClose()
    } catch (err) {
      const message =
        err &&
        typeof err === "object" &&
        "type" in err &&
        err.type === "HostedError" &&
        "message" in err &&
        typeof err.message === "string"
          ? err.message
          : t("common.requestFailed")
      setError(message)
    } finally {
      setBusy(false)
    }
  }
  onMount(() => {
    if (props.action === "info") void perform()
  })
  return (
    <Dialog title={label()} fit>
      <div class="dialog-confirm-body">
        <Show when={props.action === "delete"}>
          <span>{t("session.delete.confirm", { name: props.route.title })}</span>
        </Show>
        <Show when={props.action === "rename"}>
          <label class="am-project-dialog-field">
            <span>{t("diffViewer.source.session.label")}</span>
            <input
              class="am-nv-name-input"
              value={title()}
              maxLength={200}
              autofocus
              disabled={busy()}
              onInput={(e) => setTitle(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && title().trim()) void perform()
              }}
            />
          </label>
        </Show>
        <Show when={props.action === "info"}>
          <Show when={busy()}>
            <span role="status">{t("session.messages.loading")}</span>
          </Show>
          <Show when={info()}>{(i) => <SessionDetails info={i()} route={props.route} />}</Show>
        </Show>
        <Show when={error()}>{(e) => <div role="alert">{e()}</div>}</Show>
        <div class="dialog-confirm-actions">
          <Button variant="ghost" size="large" onClick={props.onClose} disabled={busy() && props.action !== "info"}>
            {t(props.action === "info" ? "common.close" : "common.cancel")}
          </Button>
          <Show when={props.action !== "info" || error()}>
            <Button
              variant="primary"
              size="large"
              disabled={busy() || (props.action === "rename" && !title().trim())}
              onClick={() => void perform()}
            >
              {props.action === "info" ? t("common.retry") : label()}
            </Button>
          </Show>
        </div>
      </div>
    </Dialog>
  )
}

function SessionDetails(props: { info: HostedManagement.Info; route: ChatRoute }) {
  const { t } = useLanguage()
  const money = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 6 })
  const rows = () =>
    [
      [t("diffViewer.source.session.label"), props.info.title || props.route.title],
      ["ID", props.route.target.sessionID],
      [t("agentManager.project.urlLabel"), props.route.repository],
      [t("diffViewer.source.workspace.label"), props.info.branch],
      [t("agentManager.cloud.model"), props.info.model],
      [t("ui.messagePart.board.agent"), props.info.agent],
      [
        t("context.usage.sessionCost"),
        props.info.totalCostMicrodollars === null
          ? undefined
          : money.format(props.info.totalCostMicrodollars / 1_000_000),
      ],
    ] as const
  return (
    <dl class="am-cloud-session-info">
      <For each={rows()}>
        {(row) => (
          <>
            <dt>{row[0]}</dt>
            <dd>{row[1] ?? t("provider.anaconda.status.unavailable")}</dd>
          </>
        )}
      </For>
    </dl>
  )
}
