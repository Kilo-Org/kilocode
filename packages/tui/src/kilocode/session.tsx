// Kilo's commands for the current session: `/copy-session` and `/sandbox` with its prompt footer indicator. They
// share one builtin so the Kilo builtins take one row in the Plugins dialog.
import { Plugin } from "@opencode/plugin/tui"
import { copySession } from "./copy-session"
import { sandbox } from "./sandbox"

export default Plugin.define({
  id: "kilocode.session",
  setup(context) {
    copySession(context)
    sandbox(context)
  },
})
