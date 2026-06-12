import { showToast } from "@kilocode/kilo-ui/toast"
import type { LanguageContextValue } from "../language"

export function createWorkStyleToasts(t: LanguageContextValue["t"], open: () => void) {
  return {
    saved() {
      showToast({
        variant: "success",
        icon: "circle-check",
        title: t("workStyle.toast.saved.title"),
        description: t("workStyle.toast.saved.description"),
        actions: [
          {
            label: t("workStyle.toast.saved.action"),
            onClick: open,
          },
        ],
      })
    },
    failed(message: string, persistent: boolean) {
      showToast({
        variant: "error",
        title: t("common.requestFailed"),
        description: message,
        persistent,
      })
    },
  }
}
