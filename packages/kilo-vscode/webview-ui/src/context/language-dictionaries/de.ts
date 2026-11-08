import { dict as app } from "../../i18n/de"
import { dict as ui } from "@kilocode/kilo-ui/i18n/de"
import { dict as kilo } from "@kilocode/kilo-i18n/de"
import { dict as english } from "../../../agent-manager/i18n/en"
import { dict as am } from "../../../agent-manager/i18n/de"

export default function dictionary(base: Record<string, string>): Record<string, string> {
  return { ...base, ...app, ...ui, ...kilo, ...english, ...am }
}
