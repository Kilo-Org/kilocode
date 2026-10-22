import { createUniqueId, Show } from "solid-js"
import { Button } from "@kilocode/kilo-web-ui/button"
import { Icon } from "@kilocode/kilo-web-ui/icon"

type Props = {
  open: boolean
  title: string
  message?: string
  confirm?: string
  cancel?: string
  busy?: boolean
  onCancel: () => void
  onConfirm: () => void
}

export function ConfirmDialog(props: Props) {
  const id = createUniqueId()
  const title = `${id}-title`
  const message = `${id}-message`

  return (
    <Show when={props.open}>
      <div class="confirm-scrim" onKeyDown={(event) => event.key === "Escape" && props.onCancel()}>
        <section
          class="confirm-dialog"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby={title}
          aria-describedby={props.message ? message : undefined}
        >
          <div class="confirm-body">
            <div class="confirm-icon" aria-hidden="true">
              <Icon name="warning" />
            </div>
            <div>
              <h2 id={title}>{props.title}</h2>
              <Show when={props.message}>{(text) => <p id={message}>{text()}</p>}</Show>
            </div>
          </div>
          <footer class="confirm-actions">
            <Button variant="ghost" disabled={props.busy} onClick={props.onCancel} autofocus>
              {props.cancel ?? "Cancel"}
            </Button>
            <Button variant="primary" disabled={props.busy} onClick={props.onConfirm}>
              {props.confirm ?? "Confirm"}
            </Button>
          </footer>
        </section>
      </div>
    </Show>
  )
}
