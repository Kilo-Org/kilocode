import { Show } from "solid-js"
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
  return (
    <Show when={props.open}>
      <div class="confirm-scrim">
        <section class="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
          <div class="confirm-body">
            <div class="confirm-icon" aria-hidden="true">
              <Icon name="warning" />
            </div>
            <div>
              <h2 id="confirm-title">{props.title}</h2>
              <Show when={props.message}>{(text) => <p>{text()}</p>}</Show>
            </div>
          </div>
          <footer class="confirm-actions">
            <Button variant="ghost" disabled={props.busy} onClick={props.onCancel}>
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
