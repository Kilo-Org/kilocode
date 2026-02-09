// kilocode_change - new file
import { SelectDropdown, DropdownOptionType, Button, StandardTooltip } from "@/components/ui"
import { vscode } from "@/utils/vscode"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { cn } from "@/lib/utils"
import { Check, Pin } from "lucide-react"

interface ApiConfigMeta {
	id: string
	name: string
}

interface KiloProfileSelectorProps {
	currentConfigId: string
	currentApiConfigName?: string
	displayName: string
	listApiConfigMeta?: ApiConfigMeta[]
	pinnedApiConfigs?: Record<string, boolean>
	togglePinnedApiConfig: (configId: string) => void
	selectApiConfigDisabled?: boolean
	initiallyOpen?: boolean
}

export const KiloProfileSelector = ({
	currentConfigId,
	currentApiConfigName,
	displayName,
	listApiConfigMeta,
	pinnedApiConfigs,
	togglePinnedApiConfig,
	selectApiConfigDisabled = false,
	initiallyOpen = false,
}: KiloProfileSelectorProps) => {
	const { t } = useAppTranslation()

	// Hide if there is only one profile
	if ((listApiConfigMeta?.length ?? 0) < 2) {
		return null
	}

	return (
		<div className={cn("flex-1", "min-w-0", "overflow-hidden")}>
			<SelectDropdown
				value={currentConfigId}
				disabled={selectApiConfigDisabled}
				title={t("chat:selectApiConfig")}
				disableSearch={false}
				placeholder={displayName}
				initiallyOpen={initiallyOpen}
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
				contentClassName="max-h-[400px] overflow-y-auto"
				// kilocode_change start - VSC Theme
				triggerClassName={cn(
					"w-full text-ellipsis overflow-hidden",
					"bg-[var(--background)] border-[var(--vscode-input-border)] hover:bg-[var(--color-vscode-list-hoverBackground)]",
				)}
				// kilocode_change end
				itemClassName="group"
				renderItem={({ type, value, label, pinned }) => {
					if (type !== DropdownOptionType.ITEM) {
						return <div className="py-1.5 px-3">{label}</div>
					}

					const config = listApiConfigMeta?.find((c) => c.id === value)
					const isCurrentConfig = config?.name === currentApiConfigName

					return (
						<div className="flex justify-between gap-2 w-full py-1.5 px-3">
							<div
								className={cn("truncate min-w-0 overflow-hidden", {
									"font-medium": isCurrentConfig,
								})}>
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
								<StandardTooltip content={pinned ? t("chat:unpin") : t("chat:pin")}>
									<Button
										variant="ghost"
										size="icon"
										onClick={(e) => {
											e.stopPropagation()
											togglePinnedApiConfig(value)
											vscode.postMessage({
												type: "toggleApiConfigPin",
												text: value,
											})
										}}
										className={cn("size-5", {
											"hidden group-hover:flex": !pinned,
											"bg-accent": pinned,
										})}>
										<Pin className="size-3 p-0.5 opacity-50" />
									</Button>
								</StandardTooltip>
							</div>
						</div>
					)
				}}
			/>
		</div>
	)
}
