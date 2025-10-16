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

export function getMemoryPercentage() {
	if ("memory" in performance && typeof performance.memory === "object") {
		const memory = performance.memory as {
			totalJSHeapSize: number
			usedJSHeapSize: number
			jsHeapSizeLimit: number
		}
		return Math.floor((100 * memory.totalJSHeapSize) / memory.jsHeapSizeLimit)
	}
	return 0
}
