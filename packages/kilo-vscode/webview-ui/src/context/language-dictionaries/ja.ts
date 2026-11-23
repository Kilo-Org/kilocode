import { dict as app } from "../../i18n/ja"
import { dict as ui } from "@kilocode/kilo-ui/i18n/ja"
import { dict as kilo } from "@kilocode/kilo-i18n/ja"
import { dict as english } from "../../../agent-manager/i18n/en"
import { dict as am } from "../../../agent-manager/i18n/ja"

export default function dictionary(base: Record<string, string>): Record<string, string> {
  return { ...base, ...app, ...ui, ...kilo, ...english, ...am }
}
