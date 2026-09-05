// kilocode_change - Auto Mode permission gate. In Auto Mode the TUI auto-replies "once" to permission
// requests, but a request that requires an interactive human (skillShell / sandboxEscalation /
// actionGateDegraded) must NOT be auto-answered: the server refuses a non-interactive approval, so
// auto-replying would leave an INVISIBLE pending prompt. This predicate decides whether Auto Mode may
// auto-reply; when it returns false the caller falls through and adds the request to the visible store.
import { requiresInteractiveApproval } from "@/kilocode/permission/interactive-approval"

export function shouldAutoReply(mode: string, metadata: { readonly [k: string]: unknown } | undefined): boolean {
  return mode === "auto" && !requiresInteractiveApproval(metadata)
}
