import { vscode } from "../utils/vscode"

export function showSystemNotification(message: string) {
	vscode.postMessage({
		type: "showSystemNotification",
		notificationOptions: {
			message,
		},
	})
}
