import { debugOS } from "./os/index.js"
import { debugKeyboard } from "./keyboard/index.js"

export const DEBUG_MODES = ["os", "keyboard"]

export const DEBUG_FUNCTIONS = {
	os: debugOS,
	keyboard: debugKeyboard,
}
