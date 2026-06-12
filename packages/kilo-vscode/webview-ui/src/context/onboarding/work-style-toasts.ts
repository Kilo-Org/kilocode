import { showToast } from "@kilocode/kilo-ui/toast"
import type { LanguageContextValue } from "../language"

export function createWorkStyleToasts(t: LanguageContextValue["t"]) {
  return {
    saved() {
      showToast({
        variant: "success",
        icon: "circle-check",
        title: t("workStyle.toast.saved.title"),
        duration: 2000,
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
