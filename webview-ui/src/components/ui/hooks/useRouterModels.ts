import { useQuery } from "@tanstack/react-query"

import { RouterModels } from "@roo/api"
import { ExtensionMessage } from "@roo/ExtensionMessage"

import { vscode } from "@src/utils/vscode"

const getRouterModels = async () =>
	new Promise<RouterModels>((resolve, reject) => {
		const cleanup = () => {
			window.removeEventListener("message", handler)
		}

		const timeout = setTimeout(() => {
			cleanup()
			reject(new Error("Router models request timed out"))
		}, 10000)

		const handler = (event: MessageEvent) => {
			const message: ExtensionMessage = event.data

			if (message.type === "routerModels") {
				clearTimeout(timeout)
				cleanup()

				if (message.routerModels) {
					resolve(message.routerModels)
				} else {
					reject(new Error("No router models in response"))
				}
			}
		}

		window.addEventListener("message", handler)
		vscode.postMessage({ type: "requestRouterModels" })
	})

// kilocode_change start
type RouterModelsQueryKey = {
	openRouterBaseUrl?: string
	openRouterApiKey?: string
	lmStudioBaseUrl?: string
	ollamaBaseUrl?: string
	cometApiKey?: string
	cometApiBaseUrl?: string
	// Requesty, Unbound, etc should perhaps also be here, but they already have their own hacks for reloading
}

export const useRouterModels = (queryKey: RouterModelsQueryKey) =>
	useQuery({ queryKey: ["routerModels", queryKey], queryFn: getRouterModels })
// kilocode_change end
