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

type OpenProps = Pick<BasicToolProps, "tool" | "callID" | "partID" | "forceOpen" | "defaultOpen">

export function initialOpen(props: OpenProps) {
  return props.forceOpen ? true : readToolOpen(toolOpenKey(props), props.defaultOpen)
}

export function BasicTool(props: BasicToolProps) {
  const key = () => toolOpenKey(props)
  const initial = () => initialOpen(props)
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
