//kilocode_change - new file
import { HTMLAttributes } from "react"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { Trans } from "react-i18next"
import { Bot, Zap } from "lucide-react"
import { cn } from "@/lib/utils"
import { SectionHeader } from "../../settings/SectionHeader"
import { Section } from "../../settings/Section"
import { GhostServiceSettings } from "@roo-code/types"
import { SetCachedStateField } from "../../settings/types"
import { Slider } from "@src/components/ui"
import { vscode } from "@/utils/vscode"
import { ControlledCheckbox } from "../common/ControlledCheckbox"
import { useKeybindings } from "@/hooks/useKeybindings"

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
	const { enableAutoTrigger, autoTriggerDelay, enableQuickInlineTaskKeybinding, enableSmartInlineTaskKeybinding } =
		ghostServiceSettings || {}
	const keybindings = useKeybindings(["kilo-code.ghost.promptCodeSuggestion", "kilo-code.ghost.generateSuggestions"])

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
				<div className="flex flex-col gap-3">
					<div className="flex flex-col gap-1">
						<div className="flex items-center gap-2 font-bold">
							<Zap className="w-4" />
							<div>{t("kilocode:ghost.settings.triggers")}</div>
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

					<div className="flex flex-col gap-1">
						<ControlledCheckbox
							checked={enableQuickInlineTaskKeybinding || false}
							onChange={onEnableQuickInlineTaskKeybindingChange}>
							<span className="font-medium">
								{t("kilocode:ghost.settings.enableQuickInlineTaskKeybinding.label", {
									keybinding: keybindings["kilo-code.ghost.promptCodeSuggestion"],
								})}
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
											className="text-[var(--vscode-list-highlightForeground)] hover:underline cursor-pointer"></a>
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
								{t("kilocode:ghost.settings.enableSmartInlineTaskKeybinding.label", {
									keybinding: keybindings["kilo-code.ghost.generateSuggestions"],
								})}
							</span>
						</ControlledCheckbox>
						<div className="text-vscode-descriptionForeground text-sm mt-1">
							<Trans
								i18nKey="kilocode:ghost.settings.enableSmartInlineTaskKeybinding.description"
								values={{ keybinding: keybindings["kilo-code.ghost.generateSuggestions"] }}
								components={{
									DocsLink: (
										<a
											href="#"
											onClick={() => openGlobalKeybindings("kilo-code.ghost.generateSuggestions")}
											className="text-[var(--vscode-list-highlightForeground)] hover:underline cursor-pointer"></a>
									),
								}}
							/>
						</div>
					</div>
				</div>
			</Section>
		</div>
	)
}
