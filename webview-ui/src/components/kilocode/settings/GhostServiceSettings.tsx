//kilocode_change - new file
import { HTMLAttributes } from "react"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { Trans } from "react-i18next"
import { Bot, Webhook, Keyboard, SquareFunction } from "lucide-react"
import { cn } from "@/lib/utils"
import { useExtensionState } from "../../../context/ExtensionStateContext"
import { SectionHeader } from "../../settings/SectionHeader"
import { Section } from "../../settings/Section"
import { GhostServiceSettings } from "@roo-code/types"
import { SetCachedStateField } from "../../settings/types"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Slider } from "@src/components/ui"
import { vscode } from "@/utils/vscode"
import { ControlledCheckbox } from "../common/ControlledCheckbox"

type GhostServiceSettingsViewProps = HTMLAttributes<HTMLDivElement> & {
	ghostServiceSettings: GhostServiceSettings
	setCachedStateField: SetCachedStateField<"ghostServiceSettings">
}

export const GhostServiceSettingsView = ({
	ghostServiceSettings,
	setCachedStateField,
	className,
	...props
}: GhostServiceSettingsViewProps) => {
	const { t } = useAppTranslation()
	const {
		enableAutoTrigger,
		autoTriggerDelay,
		apiConfigId,
		enableQuickInlineTaskKeybinding,
		enableSmartInlineTaskKeybinding,
	} = ghostServiceSettings || {}
	const { listApiConfigMeta } = useExtensionState()

	const onEnableAutoTriggerChange = (newValue: boolean) => {
		setCachedStateField("ghostServiceSettings", {
			...ghostServiceSettings,
			enableAutoTrigger: newValue,
		})
	}

	const onAutoTriggerDelayChange = (newValue: number[]) => {
		setCachedStateField("ghostServiceSettings", {
			...ghostServiceSettings,
			autoTriggerDelay: newValue[0],
		})
	}

	const onEnableQuickInlineTaskKeybindingChange = (newValue: boolean) => {
		setCachedStateField("ghostServiceSettings", {
			...ghostServiceSettings,
			enableQuickInlineTaskKeybinding: newValue,
		})
	}

	const onEnableSmartInlineTaskKeybindingChange = (newValue: boolean) => {
		setCachedStateField("ghostServiceSettings", {
			...ghostServiceSettings,
			enableSmartInlineTaskKeybinding: newValue,
		})
	}

	const onApiConfigIdChange = (value: string) => {
		setCachedStateField("ghostServiceSettings", {
			...ghostServiceSettings,
			apiConfigId: value === "-" ? "" : value,
		})
	}

	const openGlobalKeybindings = (filter?: string) => {
		vscode.postMessage({ type: "openGlobalKeybindings", text: filter })
	}

	return (
		<div className={cn("flex flex-col", className)} {...props}>
			<SectionHeader>
				<div className="flex items-center gap-2">
					<Bot className="w-4" />
					<div>{t("kilocode:ghost.title")}</div>
				</div>
			</SectionHeader>

			<Section className="flex flex-col gap-5">
				{/* Auto Trigger Settings */}
				<div className="flex flex-col gap-3">
					<div className="flex flex-col gap-1">
						<div className="flex items-center gap-2 font-bold">
							<SquareFunction className="w-4" />
							<div>{t("kilocode:ghost.settings.autoTrigger")}</div>
						</div>
					</div>

					<div className="flex flex-col gap-1">
						<ControlledCheckbox checked={enableAutoTrigger || false} onChange={onEnableAutoTriggerChange}>
							<span className="font-medium">{t("kilocode:ghost.settings.enableAutoTrigger.label")}</span>
						</ControlledCheckbox>
						<div className="text-vscode-descriptionForeground text-sm mt-1">
							<Trans i18nKey="kilocode:ghost.settings.enableAutoTrigger.description" />
						</div>
					</div>

					{enableAutoTrigger && (
						<div className="flex flex-col gap-1">
							<label className="block font-medium text-sm">
								{t("kilocode:ghost.settings.autoTriggerDelay.label")}
							</label>
							<div className="flex items-center gap-3">
								<Slider
									value={[autoTriggerDelay || 3]}
									onValueChange={onAutoTriggerDelayChange}
									min={1}
									max={30}
									step={1}
									className="flex-1"
									disabled={!enableAutoTrigger}
								/>
								<span className="text-sm text-vscode-descriptionForeground w-8 text-right">
									{autoTriggerDelay || 3}s
								</span>
							</div>
							<div className="text-vscode-descriptionForeground text-xs mt-1">
								<Trans i18nKey="kilocode:ghost.settings.autoTriggerDelay.description" />
							</div>
						</div>
					)}
				</div>

				{/* Keyboard Settings */}
				<div className="flex flex-col gap-3">
					<div className="flex flex-col gap-1">
						<div className="flex items-center gap-2 font-bold">
							<Keyboard className="w-4" />
							<div>{t("kilocode:ghost.settings.triggers")}</div>
						</div>
					</div>

					<div className="text-vscode-descriptionForeground text-sm mb-3">
						<Trans
							i18nKey="kilocode:ghost.settings.keybindingDescription"
							components={{
								DocsLink: (
									<a
										href="#"
										onClick={() => openGlobalKeybindings()}
										className="text-vscode-textLink hover:text-vscode-textLinkActive cursor-pointer"></a>
								),
							}}
						/>
					</div>

					<div className="flex flex-col gap-1">
						<ControlledCheckbox
							checked={enableQuickInlineTaskKeybinding || false}
							onChange={onEnableQuickInlineTaskKeybindingChange}>
							<span className="font-medium">
								{t("kilocode:ghost.settings.enableQuickInlineTaskKeybinding.label")}
							</span>
						</ControlledCheckbox>
						<div className="text-vscode-descriptionForeground text-sm mt-1">
							<Trans
								i18nKey="kilocode:ghost.settings.enableQuickInlineTaskKeybinding.description"
								components={{
									DocsLink: (
										<a
											href="#"
											onClick={() =>
												openGlobalKeybindings("kilo-code.ghost.promptCodeSuggestion")
											}
											className="text-vscode-textLink hover:text-vscode-textLinkActive cursor-pointer"></a>
									),
								}}
							/>
						</div>
					</div>
					<div className="flex flex-col gap-1">
						<ControlledCheckbox
							checked={enableSmartInlineTaskKeybinding || false}
							onChange={onEnableSmartInlineTaskKeybindingChange}>
							<span className="font-medium">
								{t("kilocode:ghost.settings.enableSmartInlineTaskKeybinding.label")}
							</span>
						</ControlledCheckbox>
						<div className="text-vscode-descriptionForeground text-sm mt-1">
							<Trans
								i18nKey="kilocode:ghost.settings.enableSmartInlineTaskKeybinding.description"
								components={{
									DocsLink: (
										<a
											href="#"
											onClick={() => openGlobalKeybindings("kilo-code.ghost.generateSuggestions")}
											className="text-vscode-textLink hover:text-vscode-textLinkActive cursor-pointer"></a>
									),
								}}
							/>
						</div>
					</div>
				</div>

				{/* Provider Settings */}
				<div className="flex flex-col gap-3">
					<div className="flex flex-col gap-1">
						<div className="flex items-center gap-2 font-bold">
							<Webhook className="w-4" />
							<div>{t("kilocode:ghost.settings.provider")}</div>
						</div>
					</div>
					<div className="flex flex-col gap-3">
						<div>
							<label className="block font-medium mb-1">
								{t("kilocode:ghost.settings.apiConfigId.label")}
							</label>
							<div className="flex items-center gap-2">
								<div>
									<Select value={apiConfigId || "-"} onValueChange={onApiConfigIdChange}>
										<SelectTrigger data-testid="autocomplete-api-config-select" className="w-full">
											<SelectValue
												placeholder={t("kilocode:ghost.settings.apiConfigId.current")}
											/>
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="-">
												{t("kilocode:ghost.settings.apiConfigId.current")}
											</SelectItem>
											{(listApiConfigMeta || []).map((config) => (
												<SelectItem
													key={config.id}
													value={config.id}
													data-testid={`autocomplete-${config.id}-option`}>
													{config.name} ({config.apiProvider})
												</SelectItem>
											))}
										</SelectContent>
									</Select>
									<div className="text-sm text-vscode-descriptionForeground mt-1">
										{t("kilocode:ghost.settings.apiConfigId.description")}
									</div>
								</div>
							</div>
						</div>
					</div>
				</div>
			</Section>
		</div>
	)
}
