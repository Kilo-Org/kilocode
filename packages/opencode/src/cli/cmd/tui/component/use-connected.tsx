import { createMemo } from "solid-js"
import { useSync } from "@tui/context/sync"

export function useConnected() {
  const sync = useSync()
  // kilocode_change - exclude "kilo" (anonymous autoload) alongside "opencode"
  return createMemo(() =>
    sync.data.provider.some(
      (x) => (x.id !== "opencode" && x.id !== "kilo") || Object.values(x.models).some((y) => y.cost?.input !== 0),
    ),
  )
}
