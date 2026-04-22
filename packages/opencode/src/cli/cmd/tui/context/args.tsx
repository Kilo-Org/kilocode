import { createSimpleContext } from "./helper"

// kilocode_change start
export interface Args {
  model?: string
  agent?: string
  prompt?: string
  continue?: boolean
  sessionID?: string
  fork?: boolean
  yolo?: boolean // kilocode_change
}
// kilocode_change end

export const { use: useArgs, provider: ArgsProvider } = createSimpleContext({
  name: "Args",
  init: (props: Args) => props,
})
