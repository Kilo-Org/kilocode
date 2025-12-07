import { useExtensionState } from "@/context/ExtensionStateContext"
import { vscode } from "@/utils/vscode"
import { WebviewMessage } from "@roo/WebviewMessage"
import { GaugeCircle } from "lucide-react"
import { useEffect, useState } from "react"
import { useSelectedModel } from "../ui/hooks/useSelectedModel"
import { ModelSelector } from "./chat/ModelSelector"

export const BottomApiConfig = () => {
	const { currentApiConfigName, apiConfiguration } = useExtensionState()
	const { id: selectedModelId, provider: selectedProvider } = useSelectedModel(apiConfiguration)
	const [usagePercentage, setUsagePercentage] = useState<number | null>(null)
	const [_isLoading, setIsLoading] = useState(false)

	useEffect(() => {
		// Only fetch usage data if we have a kilocode token
		if (apiConfiguration?.kilocodeToken) {
			setIsLoading(true)
			vscode.postMessage({ type: "fetchProfileDataRequest" })
		}
	}, [apiConfiguration?.kilocodeToken])

	useEffect(() => {
		const handleMessage = (event: MessageEvent<WebviewMessage>) => {
			const message = event.data
			if (message.type === "profileDataResponse") {
				const payload = message.payload as any
				if (payload?.success && payload.data) {
					// Extract usage percentage from profile data
					// This assumes the API response includes usage metrics as described in the task
					const profileData = payload.data as any
					if (profileData.usagePercentage !== undefined) {
						setUsagePercentage(profileData.usagePercentage)
					} else if (profileData.usedCredits !== undefined && profileData.totalCredits !== undefined) {
						// Calculate percentage from credits if usagePercentage is not directly provided
						const percentage = (profileData.usedCredits / profileData.totalCredits) * 100
						setUsagePercentage(percentage)
					}
				}
				setIsLoading(false)
			}
		}

		window.addEventListener("message", handleMessage)
		return () => {
			window.removeEventListener("message", handleMessage)
		}
	}, [])

	if (!apiConfiguration) {
		return null
	}

	return (
		<div className="flex items-center justify-center">
			{/* kilocode_change - add data-testid="model-selector" below */}
			<div className="w-auto overflow-hidden shrink-0" data-testid="model-selector">
				<ModelSelector
					currentApiConfigName={currentApiConfigName}
					apiConfiguration={apiConfiguration}
					fallbackText={`${selectedProvider}:${selectedModelId}`}
				/>
			</div>
			{apiConfiguration.kilocodeToken && usagePercentage !== null && (
				<span className="items-center justify-center flex shrink-1 overflow-hidden w-auto ml-2 text-sm text-[var(--vscode-descriptionForeground)]">
					<GaugeCircle
						size={14}
						style={{
							color: "var(--vscode-descriptionForeground)",
							marginRight: 4,
							flexShrink: 0,
						}}
					/>
					used {usagePercentage}% monthly limit
				</span>
			)}
		</div>
	)
}
