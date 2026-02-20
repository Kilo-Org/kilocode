// kilocode_change - new file
import { useRenderer } from "@opentui/solid"
import { createSignal, onCleanup } from "solid-js"
import { createSimpleContext } from "../context/helper"

export const { use: useFocused, provider: FocusProvider } = createSimpleContext({
  name: "Focus",
  init: () => {
    const renderer = useRenderer()
    const [focused, setFocused] = createSignal(true)

    const onFocus = () => setFocused(true)
    const onBlur = () => setFocused(false)
    renderer.on("focus", onFocus)
    renderer.on("blur", onBlur)

    onCleanup(() => {
      renderer.removeListener("focus", onFocus)
      renderer.removeListener("blur", onBlur)
    })

    return { focused }
  },
})
