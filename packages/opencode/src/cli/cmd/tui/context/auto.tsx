// kilocode_change - new file
import { createSignal, type Accessor } from "solid-js"
import { createSimpleContext } from "./helper"

export interface AutoMode {
  enabled: Accessor<boolean>
  toggle: () => void
}

export const { use: useAutoMode, provider: AutoModeProvider } = createSimpleContext({
  name: "AutoMode",
  init: (props: { initial?: boolean }) => {
    const [enabled, setEnabled] = createSignal(props.initial ?? false)
    return {
      enabled,
      toggle() {
        setEnabled((prev) => !prev)
      },
    }
  },
})
