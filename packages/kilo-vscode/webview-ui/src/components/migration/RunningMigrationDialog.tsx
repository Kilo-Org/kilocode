import type { Component } from "solid-js"
import { Dialog } from "@kilocode/kilo-ui/dialog"
import { Button } from "@kilocode/kilo-ui/button"
import { useDialog } from "@kilocode/kilo-ui/context/dialog"

interface RunningMigrationDialogProps {
  onConfirm: () => void
}

const RunningMigrationDialog: Component<RunningMigrationDialogProps> = (props) => {
  const dialog = useDialog()

  return (
    <Dialog title="Migration in Progress" fit>
      <div class="dialog-confirm-body">
        <p>You are about to finish while there are still sessions being migrated.</p>
        <p>If you leave now, some sessions may remain incomplete.</p>
        <div class="dialog-confirm-actions">
          <Button variant="secondary" size="large" onClick={() => dialog.close()}>
            Stay
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

export default RunningMigrationDialog
