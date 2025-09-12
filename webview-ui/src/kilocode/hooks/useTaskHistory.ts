import { ExtensionMessage } from "@roo/ExtensionMessage"
import { TaskHistoryRequestPayload, TaskHistoryResponsePayload } from "@roo/WebviewMessage"
import { vscode } from "@src/utils/vscode"
import { useQuery } from "@tanstack/react-query"

function fetchTaskHistory(payload: TaskHistoryRequestPayload): Promise<TaskHistoryResponsePayload> {
	return new Promise((resolve, reject) => {
		const cleanup = () => window.removeEventListener("message", handle)

		const timeout = setTimeout(() => {
			cleanup()
			reject(new Error("Timeout"))
		}, 10000)

		const handle = (event: MessageEvent) => {
			const message = event.data as ExtensionMessage
			if (message.type === "taskHistoryResponse") {
				clearTimeout(timeout)
				cleanup()
				const result = message.payload as TaskHistoryResponsePayload
				if (result) {
					resolve(result)
				} else {
					reject(new Error("Payload is empty"))
				}
			}
		}

		window.addEventListener("message", handle)
		vscode.postMessage({ type: "taskHistoryRequest", payload })
	})
}

export function useTaskHistory(payload: TaskHistoryRequestPayload) {
	return useQuery({
		queryKey: ["taskHistory", JSON.stringify(payload)], // SUS: there's nothing here that changes when a task gets added/deleted
		queryFn: () => fetchTaskHistory(payload),
	})
}
