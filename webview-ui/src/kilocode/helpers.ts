import { vscode } from "../utils/vscode"
import debounce from "debounce"

export const showSystemNotification = debounce((message: string) => {
	vscode.postMessage({
		type: "showSystemNotification",
		notificationOptions: {
			message,
		},
	})
})
