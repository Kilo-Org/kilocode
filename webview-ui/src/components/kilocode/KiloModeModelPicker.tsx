// kilocode_change - new file
import React, { useCallback, useMemo, useRef, useState } from "react"
import { Check, ChevronDown, X } from "lucide-react"

import type { ModelInfo } from "@roo-code/types"

import { vscode } from "@src/utils/vscode"
import { useEscapeKey } from "@src/hooks/useEscapeKey"
import { prettyModelName } from "@src/utils/prettyModelName"
import { getGroupedModelIds } from "@src/components/ui/hooks/kilocode/usePreferredModels"
import { useTranslation } from "react-i18next"
import {
	Button,
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@src/components/ui"

type KiloModeModelPickerProps = {
	modeSlug: string
	apiProvider?: string
	routerModels?: { kilocode?: Record<string, ModelInfo> }
	modeModelOverrides?: Record<string, string>
}

export const KiloModeModelPicker = ({
	modeSlug,
	apiProvider,
	routerModels,
	modeModelOverrides,
}: KiloModeModelPickerProps) => {
	const { t } = useTranslation()
	const isKiloCodeProviderActive = apiProvider === "kilocode"

	const kiloCodeModels = useMemo(() => {
		return (routerModels?.kilocode ?? {}) as Record<string, ModelInfo>
	}, [routerModels])
	const hasKiloCodeModels = Object.keys(kiloCodeModels).length > 0
	const isModeModelPickerEnabled = isKiloCodeProviderActive && hasKiloCodeModels

	const selectedModeModelId = modeModelOverrides?.[modeSlug] ?? null

	const { preferredModelIds, restModelIds } = useMemo(() => {
		return getGroupedModelIds(kiloCodeModels)
	}, [kiloCodeModels])

	const orderedKiloCodeModelIds = useMemo(() => {
		// preferredModelIds are already sorted by preferredIndex; restModelIds are already alphabetical.
		return [...preferredModelIds, ...restModelIds]
	}, [preferredModelIds, restModelIds])

	const getKiloCodeModelLabel = useCallback(
		(modelId: string) => {
			return kiloCodeModels?.[modelId]?.displayName ?? prettyModelName(modelId)
		},
		[kiloCodeModels],
	)

	const selectedModeModelLabel = selectedModeModelId
		? getKiloCodeModelLabel(selectedModeModelId)
		: t("kilocode:modeModelPicker.useDefault")

	const [modelPickerOpen, setModelPickerOpen] = useState(false)
	const [modelSearchValue, setModelSearchValue] = useState("")
	const modelSearchInputRef = useRef<HTMLInputElement>(null)

	// Use the shared ESC key handler hook
	useEscapeKey(modelPickerOpen, () => setModelPickerOpen(false))

	const filteredKiloCodeModelIds = useMemo(() => {
		if (!modelSearchValue) return orderedKiloCodeModelIds
		const needle = modelSearchValue.toLowerCase()
		return orderedKiloCodeModelIds.filter((modelId) => {
			const label = getKiloCodeModelLabel(modelId)
			return `${modelId} ${label}`.toLowerCase().includes(needle)
		})
	}, [modelSearchValue, orderedKiloCodeModelIds, getKiloCodeModelLabel])

	return (
		<div className="mb-3">
			<div className="font-bold mb-1">{t("kilocode:modeModelPicker.label")}</div>
			<div className="text-sm text-vscode-descriptionForeground mb-2">
				{t("kilocode:modeModelPicker.description")}
			</div>
			<div className="mb-2">
				<Popover
					open={modelPickerOpen}
					onOpenChange={(nextOpen) => {
						setModelPickerOpen(nextOpen)
						if (!nextOpen) {
							setTimeout(() => setModelSearchValue(""), 100)
						}
					}}>
					<PopoverTrigger asChild>
						<Button
							variant="combobox"
							role="combobox"
							aria-expanded={modelPickerOpen}
							className="justify-between w-full"
							disabled={!isModeModelPickerEnabled}
							data-testid="mode-model-select-trigger">
							<div className="truncate">{selectedModeModelLabel}</div>
							<ChevronDown className="opacity-50" />
						</Button>
					</PopoverTrigger>
					<PopoverContent className="p-0 w-[var(--radix-popover-trigger-width)]">
						<Command>
							<div className="relative">
								<CommandInput
									ref={modelSearchInputRef}
									value={modelSearchValue}
									onValueChange={setModelSearchValue}
									placeholder={t("kilocode:modeModelPicker.searchPlaceholder")}
									className="h-9 mr-4"
									data-testid="mode-model-search-input"
								/>
								{modelSearchValue.length > 0 && (
									<div className="absolute right-2 top-0 bottom-0 flex items-center justify-center">
										<X
											className="text-vscode-input-foreground opacity-50 hover:opacity-100 size-4 p-0.5 cursor-pointer"
											onClick={() => {
												setModelSearchValue("")
												modelSearchInputRef.current?.focus()
											}}
										/>
									</div>
								)}
							</div>
							<CommandList>
								<CommandEmpty>
									{modelSearchValue && (
										<div className="py-2 px-1 text-sm">{t("kilocode:modeModelPicker.noMatch")}</div>
									)}
								</CommandEmpty>
								<CommandGroup>
									<CommandItem
										value="__default__"
										onSelect={() => {
											vscode.postMessage({
												type: "setModeModelOverride",
												payload: { mode: modeSlug, modelId: null },
											})
											setModelPickerOpen(false)
										}}
										data-testid="mode-model-option-default">
										<div className="flex items-center gap-2 w-full">
											<Check
												className={`size-4 ${selectedModeModelId ? "opacity-0" : "opacity-100"}`}
											/>
											<span>{t("kilocode:modeModelPicker.useDefault")}</span>
										</div>
									</CommandItem>
									{filteredKiloCodeModelIds.map((modelId) => (
										<CommandItem
											key={modelId}
											value={`${getKiloCodeModelLabel(modelId)} ${modelId}`}
											onSelect={() => {
												vscode.postMessage({
													type: "setModeModelOverride",
													payload: { mode: modeSlug, modelId },
												})
												setModelPickerOpen(false)
											}}
											data-testid={`mode-model-option-${modelId}`}>
											<div className="flex items-center gap-2 w-full">
												<Check
													className={`size-4 ${
														selectedModeModelId === modelId ? "opacity-100" : "opacity-0"
													}`}
												/>
												<span className="truncate">{getKiloCodeModelLabel(modelId)}</span>
											</div>
										</CommandItem>
									))}
								</CommandGroup>
							</CommandList>
						</Command>
					</PopoverContent>
				</Popover>
			</div>
			{!isKiloCodeProviderActive ? (
				<div
					className="text-xs text-vscode-descriptionForeground"
					data-testid="mode-model-helper-provider-inactive">
					{t("kilocode:modeModelPicker.providerInactive")}
				</div>
			) : !hasKiloCodeModels ? (
				<div
					className="text-xs text-vscode-descriptionForeground"
					data-testid="mode-model-helper-models-unavailable">
					{t("kilocode:modeModelPicker.modelsUnavailable")}
					{selectedModeModelId && (
						<span data-testid="mode-model-helper-override-warning">
							{" "}
							{t("kilocode:modeModelPicker.overrideWillNotApply")}
						</span>
					)}
				</div>
			) : null}
		</div>
	)
}
