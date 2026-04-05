import type { Component } from "solid-js"
import { Dialog } from "@kilocode/kilo-ui/dialog"
import { Button } from "@kilocode/kilo-ui/button"
import { useDialog } from "@kilocode/kilo-ui/context/dialog"

interface ForceReimportDialogProps {
  count: number
  onConfirm: () => void
}

const ForceReimportDialog: Component<ForceReimportDialogProps> = (props) => {
  const dialog = useDialog()

  return (
    <Dialog title="Force Re-import" fit>
      <div class="dialog-confirm-body">
        <p>
          Re-importing {props.count === 1 ? "this session" : `these ${props.count} sessions`} will overwrite them and
          delete any progress already made in those migrated sessions.
        </p>
        <div class="dialog-confirm-actions">
          <Button variant="secondary" size="large" onClick={() => dialog.close()}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="large"
            onClick={() => {
              props.onConfirm()
              dialog.close()
            }}
          >
            Proceed
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

export default ForceReimportDialog
