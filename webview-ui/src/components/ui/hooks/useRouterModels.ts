import { useQuery } from "@tanstack/react-query"

import { type RouterModels, type ExtensionMessage } from "@roo-code/types"

import { vscode } from "@src/utils/vscode"

type UseRouterModelsOptions = {
	provider?: string // single provider filter (e.g. "roo")
	enabled?: boolean // gate fetching entirely
}

const getRouterModels = async (provider?: string) =>
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
				const msgProvider = message?.values?.provider as string | undefined

				// Verify response matches request
				if (provider !== msgProvider) {
					// Not our response; ignore and wait for the matching one
					return
				}

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
		if (provider) {
			vscode.postMessage({ type: "requestRouterModels", values: { provider } })
		} else {
			vscode.postMessage({ type: "requestRouterModels" })
		}
	})

// kilocode_change start
type RouterModelsQueryKey = {
	openRouterBaseUrl?: string
	openRouterApiKey?: string
	lmStudioBaseUrl?: string
	ollamaBaseUrl?: string
	kilocodeOrganizationId?: string
	deepInfraApiKey?: string
	geminiApiKey?: string
	googleGeminiBaseUrl?: string
	chutesApiKey?: string
	nanoGptApiKey?: string
	nanoGptModelList?: "all" | "personalized" | "subscription"
	syntheticApiKey?: string
	// Requesty, Unbound, etc should perhaps also be here, but they already have their own hacks for reloading
}
// kilocode_change end

export const useRouterModels = (queryKey: RouterModelsQueryKey, opts: UseRouterModelsOptions = {}) => {
	const provider = opts.provider || undefined
	return useQuery({
		queryKey: ["routerModels", provider || "all", queryKey],
		queryFn: () => getRouterModels(provider),
		enabled: opts.enabled !== false,
	})
}
