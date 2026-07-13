// kilocode_change - new file
/**
 * "Continue your /remote sessions in the Kilo mobile app" promo notice.
 *
 * Only shown to users who have previously enabled a Cloud Agent / remote session relay
 * (`Notices.markCloudAgentUsed()` in `@/kilocode/notices`, set from `enableRemote()` in
 * `src/kilo-sessions/kilo-sessions.ts`). Persists until the user explicitly dismisses it
 * via the "don't show again" action.
 */
import { onMount } from "solid-js"
import type { useDialog } from "@tui/ui/dialog"
import { DialogRetryAction } from "@tui/component/dialog-retry-action"

export const MOBILE_APP_NOTICE_URL = "https://blog.kilo.ai/p/kilo-app-for-ios-and-android-is-live"

// Loosely typed to avoid coupling this module to the exact generated SDK client shape.
type SDKLike = {
  client: {
    kilocode: {
      mobileAppNotice: (...args: any[]) => Promise<{ data?: { show: boolean } }>
      dismissMobileAppNotice: (...args: any[]) => Promise<unknown>
    }
  }
}

export function useMobileAppNotice(deps: { sdk: SDKLike; dialog: ReturnType<typeof useDialog> }) {
  onMount(() => {
    void (async () => {
      if (deps.dialog.stack.length > 0) return
      const res = await deps.sdk.client.kilocode.mobileAppNotice().catch(() => null)
      if (!res?.data?.show) return
      if (deps.dialog.stack.length > 0) return

      const dontShowAgain = await DialogRetryAction.show(deps.dialog, {
        title: "Kilo Mobile App",
        message: "Continue your /remote sessions in the Kilo mobile app.",
        label: "Open",
        link: MOBILE_APP_NOTICE_URL,
      })
      if (dontShowAgain) await deps.sdk.client.kilocode.dismissMobileAppNotice().catch(() => undefined)
    })()
  })
}
