import { BasicTool as Base, GenericTool } from "@opencode-ai/ui/basic-tool"
import type { BasicToolProps as BaseProps, TriggerTitle } from "@opencode-ai/ui/basic-tool"
import { toolOpenKey, readToolOpen, writeToolOpen } from "./tool-open-state"

export { GenericTool }
export type { TriggerTitle }

export interface BasicToolProps extends BaseProps {
  tool?: string
  callID?: string
  partID?: string
}

export function BasicTool(props: BasicToolProps) {
  const key = () => toolOpenKey(props)
  const initial = () => (props.forceOpen ? true : readToolOpen(key(), props.defaultOpen))
  return (
    <Base
      {...props}
      defaultOpen={initial()}
      onOpenChange={(open) => {
        writeToolOpen(key(), open)
        props.onOpenChange?.(open)
      }}
    />
  )
}
