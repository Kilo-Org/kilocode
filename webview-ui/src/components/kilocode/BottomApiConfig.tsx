import { useMemo } from "react"
import { vscode } from "../../utils/vscode"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { ModelSelector } from "./chat/ModelSelector"
import { cn } from "@/lib/utils"
import { SelectDropdown, DropdownOptionType, Button } from "@/components/ui"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useSelectedModel } from "../ui/hooks/useSelectedModel"
import { ProviderSettings } from "@roo-code/types"
import { Check, Pin } from "lucide-react"

interface BottomControlsProps {
	selectApiConfigDisabled?: boolean
}

export const BottomApiConfig = ({ selectApiConfigDisabled = false }: BottomControlsProps) => {
	const { t } = useAppTranslation()

	const { currentApiConfigName, listApiConfigMeta, pinnedApiConfigs, togglePinnedApiConfig, apiConfiguration } =
		useExtensionState()

	// Find the ID and display text for the currently selected API configuration
	const { currentConfigId, displayName } = useMemo(() => {
		const currentConfig = listApiConfigMeta?.find((config) => config.name === currentApiConfigName)
		return {
			currentConfigId: currentConfig?.id || "",
			displayName: currentApiConfigName || "", // Use the name directly for display
		}
	}, [listApiConfigMeta, currentApiConfigName])

	const { id: selectedModelId, provider: selectedProvider } = useSelectedModel(apiConfiguration)

	return (
		<>
			<div className="w-auto overflow-hidden">
				<SelectDropdown
					value={currentConfigId}
					disabled={selectApiConfigDisabled}
					title={t("chat:selectApiConfig")}
					placeholder={displayName}
					options={[
						// Pinned items first.
						...(listApiConfigMeta || [])
							.filter((config) => pinnedApiConfigs && pinnedApiConfigs[config.id])
							.map((config) => ({
								value: config.id,
								label: config.name,
								name: config.name, // Keep name for comparison with currentApiConfigName.
								type: DropdownOptionType.ITEM,
								pinned: true,
							}))
							.sort((a, b) => a.label.localeCompare(b.label)),
						// If we have pinned items and unpinned items, add a separator.
						...(pinnedApiConfigs &&
						Object.keys(pinnedApiConfigs).length > 0 &&
						(listApiConfigMeta || []).some((config) => !pinnedApiConfigs[config.id])
							? [
									{
										value: "sep-pinned",
										label: t("chat:separator"),
										type: DropdownOptionType.SEPARATOR,
									},
								]
							: []),
						// Unpinned items sorted alphabetically.
						...(listApiConfigMeta || [])
							.filter((config) => !pinnedApiConfigs || !pinnedApiConfigs[config.id])
							.map((config) => ({
								value: config.id,
								label: config.name,
								name: config.name, // Keep name for comparison with currentApiConfigName.
								type: DropdownOptionType.ITEM,
								pinned: false,
							}))
							.sort((a, b) => a.label.localeCompare(b.label)),
						{
							value: "sep-2",
							label: t("chat:separator"),
							type: DropdownOptionType.SEPARATOR,
						},
						{
							value: "settingsButtonClicked",
							label: t("chat:edit"),
							type: DropdownOptionType.ACTION,
						},
					]}
					onChange={(value) => {
						if (value === "settingsButtonClicked") {
							vscode.postMessage({
								type: "loadApiConfiguration",
								text: value,
								values: { section: "providers" },
							})
						} else {
							vscode.postMessage({ type: "loadApiConfigurationById", text: value })
						}
					}}
					contentClassName="max-h-[300px] overflow-y-auto"
					triggerClassName={cn(
						"w-full text-ellipsis overflow-hidden",
						"bg-[var(--vscode-input-background)] border-[var(--vscode-input-border)] hover:bg-[var(--color-vscode-list-hoverBackground)]",
					)}
					itemClassName="group"
					renderItem={({ type, value, label, pinned }) => {
						if (type !== DropdownOptionType.ITEM) {
							return label
						}

						const config = listApiConfigMeta?.find((c) => c.id === value)
						const isCurrentConfig = config?.name === currentApiConfigName

						return (
							<div className="flex justify-between gap-2 w-full h-5">
								<div
									className={cn("truncate min-w-0 overflow-hidden", {
										"font-medium": isCurrentConfig,
									})}
									title={label}>
									{label}
								</div>
								<div className="flex justify-end w-10 flex-shrink-0">
									<div
										className={cn("size-5 p-1", {
											"block group-hover:hidden": !pinned,
											hidden: !isCurrentConfig,
										})}>
										<Check className="size-3" />
									</div>
									<Button
										variant="ghost"
										size="icon"
										title={pinned ? t("chat:unpin") : t("chat:pin")}
										onClick={(e) => {
											e.stopPropagation()
											togglePinnedApiConfig(value)
											vscode.postMessage({ type: "toggleApiConfigPin", text: value })
										}}
										className={cn("size-5", {
											"hidden group-hover:flex": !pinned,
											"bg-accent": pinned,
										})}>
										<Pin className="size-3 p-0.5 opacity-50" />
									</Button>
								</div>
							</div>
						)
					}}
				/>
			</div>
			<div className="w-auto overflow-hidden">
				<ModelSelector
					currentApiConfigName={currentApiConfigName}
					apiConfiguration={apiConfiguration as ProviderSettings}
					fallbackText={`${selectedProvider}:${selectedModelId}`}
				/>
			</div>
		</>
	)
}
