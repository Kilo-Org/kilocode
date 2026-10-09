import { dict as app } from "../../i18n/fa"
import { dict as ui } from "@kilocode/kilo-ui/i18n/fa"
import { dict as english } from "../../../agent-manager/i18n/en"
import { dict as am } from "../../../agent-manager/i18n/fa"

export default function dictionary(base: Record<string, string>): Record<string, string> {
  // Persian has no localized Kilo override layer, so it inherits the English base.
  return { ...base, ...app, ...ui, ...english, ...am }
}
