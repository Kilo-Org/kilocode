import { HistoryItem } from "@roo-code/types"
import { ExtensionMessage } from "@roo/ExtensionMessage"
import { TaskHistoryRequestPayload, TaskHistoryResponsePayload, TasksByIdResponsePayload } from "@roo/WebviewMessage"
import { vscode } from "@src/utils/vscode"
import { useQuery } from "@tanstack/react-query"

function fetchTask(requestId: string, taskIds: string[]): Promise<HistoryItem[]> {
	return new Promise((resolve, reject) => {
		const cleanup = () => {
			window.removeEventListener("message", handle)
		}

		const timeout = setTimeout(() => {
			cleanup()
			reject(new Error("Timeout"))
		}, 10000)

		const handle = (event: MessageEvent) => {
			const message = event.data as ExtensionMessage
			if (message.type === "tasksByIdResponse") {
				const result = message.payload as TasksByIdResponsePayload
				if (result?.requestId !== requestId) {
					return
				}
				clearTimeout(timeout)
				cleanup()
				if (result?.tasks) {
					resolve(result.tasks)
				} else {
					reject(new Error("Task not found"))
				}
			}
		}

		window.addEventListener("message", handle)
		vscode.postMessage({ type: "tasksByIdRequest", payload: { requestId, taskIds } })
	})
}

export function useTaskWithId(taskIds: string[]) {
	return useQuery({
		queryKey: ["taskHistory", taskIds],
		queryFn: () => fetchTask(crypto.randomUUID(), taskIds),
	})
}

function fetchTaskHistory(payload: TaskHistoryRequestPayload): Promise<TaskHistoryResponsePayload> {
	return new Promise((resolve, reject) => {
		const cleanup = () => {
			window.removeEventListener("message", handle)
		}

		const timeout = setTimeout(() => {
			cleanup()
			reject(new Error("Timeout"))
		}, 10000)

		const handle = (event: MessageEvent) => {
			const message = event.data as ExtensionMessage
			if (message.type === "taskHistoryResponse") {
				const result = message.payload as TaskHistoryResponsePayload
				if (result?.requestId !== payload.requestId) {
					return
				}
				clearTimeout(timeout)
				cleanup()
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

export function useTaskHistory(payload: Omit<TaskHistoryRequestPayload, "requestId">, taskHistoryVersion: number) {
	return useQuery({
		queryKey: ["taskHistory", String(taskHistoryVersion), JSON.stringify(payload)],
		queryFn: () => fetchTaskHistory({ ...payload, requestId: crypto.randomUUID() }),
	})
}
