import { useGlobalSync } from "@/context/global-sync"
import { decode64 } from "@/utils/base64"
import { useParams } from "@solidjs/router"
import { createMemo } from "solid-js"

// kilocode_change start - Preferred providers list (order determines display priority)
export const preferredProviders = [
  "kilo",
  "opencode",
  "anthropic",
  "github-copilot",
  "openai",
  "google",
  "openrouter",
  "vercel",
]
// kilocode_change end

export function useProviders() {
  const globalSync = useGlobalSync()
  const params = useParams()
  const currentDirectory = createMemo(() => decode64(params.dir) ?? "")
  const providers = createMemo(() => {
    if (currentDirectory()) {
      const [projectStore] = globalSync.child(currentDirectory())
      return projectStore.provider
    }
    return globalSync.data.provider
  })
  const connected = createMemo(() => providers().all.filter((p) => providers().connected.includes(p.id)))
  const paid = createMemo(() =>
    connected().filter((p) => p.id !== "opencode" || Object.values(p.models).find((m) => m.cost?.input)),
  )
  const preferred = createMemo(() => providers().all.filter((p) => preferredProviders.includes(p.id)))
  return {
    all: createMemo(() => providers().all),
    default: createMemo(() => providers().default),
    preferred, // kilocode_change - renamed from popular
    connected,
    paid,
  }
}
