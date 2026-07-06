import { Button } from "@kilocode/kilo-web-ui/button"
import { Input } from "@kilocode/kilo-web-ui/input"
import { createUniqueId, Show } from "solid-js"

type Props = {
  open: boolean
  title: string
  message?: string
  label: string
  value: string
  placeholder?: string
  confirm?: string
  cancel?: string
  busy?: boolean
  onInput: (value: string) => void
  onCancel: () => void
  onConfirm: () => void
}

export function PromptDialog(props: Props) {
  const id = createUniqueId()
  const title = `${id}-title`
  const message = `${id}-message`
  const input = `${id}-input`

  return (
    <Show when={props.open}>
      <div class="confirm-scrim" onKeyDown={(event) => event.key === "Escape" && props.onCancel()}>
        <section
          class="confirm-dialog prompt-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby={title}
          aria-describedby={props.message ? message : undefined}
        >
          <form
            class="prompt-form"
            onSubmit={(event) => {
              event.preventDefault()
              props.onConfirm()
            }}
          >
            <div class="prompt-body">
              <div class="prompt-copy">
                <h2 id={title}>{props.title}</h2>
                <Show when={props.message}>{(text) => <p id={message}>{text()}</p>}</Show>
              </div>
              <label class="prompt-field" for={input}>
                <span>{props.label}</span>
                <Input
                  id={input}
                  value={props.value}
                  placeholder={props.placeholder}
                  disabled={props.busy}
                  autofocus
                  onInput={(event) => props.onInput(event.currentTarget.value)}
                />
              </label>
            </div>
            <footer class="confirm-actions">
              <Button type="button" variant="ghost" disabled={props.busy} onClick={props.onCancel}>
                {props.cancel ?? "Cancel"}
              </Button>
              <Button type="submit" variant="primary" disabled={props.busy}>
                {props.confirm ?? "Confirm"}
              </Button>
            </footer>
          </form>
        </section>
      </div>
    </Show>
  )
}
