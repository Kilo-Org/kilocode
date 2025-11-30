//kilocode_change - new file
import { HTMLAttributes, useCallback } from "react"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { Trans } from "react-i18next"
import { Bot, Zap } from "lucide-react"
import { cn } from "@/lib/utils"
import { SectionHeader } from "../../settings/SectionHeader"
import { Section } from "../../settings/Section"
import { GhostServiceSettings, MODEL_SELECTION_ENABLED } from "@roo-code/types"
import { vscode } from "@/utils/vscode"
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { useKeybindings } from "@/hooks/useKeybindings"

type GhostServiceSettingsViewProps = HTMLAttributes<HTMLDivElement> & {
	ghostServiceSettings: GhostServiceSettings
	onGhostServiceSettingsChange: <K extends keyof NonNullable<GhostServiceSettings>>(
		field: K,
		value: NonNullable<GhostServiceSettings>[K],
	) => void
}

export const GhostServiceSettingsView = ({
	ghostServiceSettings,
	onGhostServiceSettingsChange,
	className,
	...props
}: GhostServiceSettingsViewProps) => {
	const { t } = useAppTranslation()
	const {
		enableAutoTrigger,
		enableQuickInlineTaskKeybinding,
		enableSmartInlineTaskKeybinding,
		useNewAutocomplete,
		provider,
		model,
	} = ghostServiceSettings || {}
	const keybindings = useKeybindings(["kilo-code.addToContextAndFocus", "kilo-code.ghost.generateSuggestions"])

	const onEnableAutoTriggerChange = useCallback(
		(e: any) => {
			onGhostServiceSettingsChange("enableAutoTrigger", e.target.checked)
		},
		[onGhostServiceSettingsChange],
	)

	const onEnableQuickInlineTaskKeybindingChange = useCallback(
		(e: any) => {
			onGhostServiceSettingsChange("enableQuickInlineTaskKeybinding", e.target.checked)
		},
		[onGhostServiceSettingsChange],
	)

	const onEnableSmartInlineTaskKeybindingChange = useCallback(
		(e: any) => {
			onGhostServiceSettingsChange("enableSmartInlineTaskKeybinding", e.target.checked)
		},
		[onGhostServiceSettingsChange],
	)

	const onUseNewAutocompleteChange = useCallback(
		(e: any) => {
			onGhostServiceSettingsChange("useNewAutocomplete", e.target.checked)
		},
		[onGhostServiceSettingsChange],
	)

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
						<VSCodeCheckbox checked={enableAutoTrigger || false} onChange={onEnableAutoTriggerChange}>
							<span className="font-medium">{t("kilocode:ghost.settings.enableAutoTrigger.label")}</span>
						</VSCodeCheckbox>
						<div className="text-vscode-descriptionForeground text-sm mt-1">
							<Trans i18nKey="kilocode:ghost.settings.enableAutoTrigger.description" />
						</div>
					</div>

					<div className="flex flex-col gap-1">
						<VSCodeCheckbox
							checked={enableQuickInlineTaskKeybinding || false}
							onChange={onEnableQuickInlineTaskKeybindingChange}>
							<span className="font-medium">
								{t("kilocode:ghost.settings.enableQuickInlineTaskKeybinding.label", {
									keybinding: keybindings["kilo-code.addToContextAndFocus"],
								})}
							</span>
						</VSCodeCheckbox>
						<div className="text-vscode-descriptionForeground text-sm mt-1">
							<Trans
								i18nKey="kilocode:ghost.settings.enableQuickInlineTaskKeybinding.description"
								components={{
									DocsLink: (
										<a
											href="#"
											onClick={() => openGlobalKeybindings("kilo-code.addToContextAndFocus")}
											className="text-[var(--vscode-list-highlightForeground)] hover:underline cursor-pointer"></a>
									),
								}}
							/>
						</div>
					</div>
					<div className="flex flex-col gap-1">
						<VSCodeCheckbox
							checked={enableSmartInlineTaskKeybinding || false}
							onChange={onEnableSmartInlineTaskKeybindingChange}>
							<span className="font-medium">
								{t("kilocode:ghost.settings.enableSmartInlineTaskKeybinding.label", {
									keybinding: keybindings["kilo-code.ghost.generateSuggestions"],
								})}
							</span>
						</VSCodeCheckbox>
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

					{MODEL_SELECTION_ENABLED && (
						<div className="flex flex-col gap-1">
							<VSCodeCheckbox checked={useNewAutocomplete || false} onChange={onUseNewAutocompleteChange}>
								<span className="font-medium">[DEV ONLY] Use Experimental New Autocomplete</span>
							</VSCodeCheckbox>
							<div className="text-vscode-descriptionForeground text-sm mt-1">
								⚠️ <strong>EXPERIMENTAL</strong>: Use the new autocomplete engine based on Continue.dev.
								This is highly experimental and may not work as expected.
							</div>
						</div>
					)}

					<div className="flex flex-col gap-1">
						<div className="flex items-center gap-2 font-bold">
							<Bot className="w-4" />
							<div>{t("kilocode:ghost.settings.model")}</div>
						</div>
					</div>

					<div className="flex flex-col gap-2">
						<div className="text-sm">
							{provider && model ? (
								<>
									<div className="text-vscode-descriptionForeground">
										<span className="font-medium">{t("kilocode:ghost.settings.provider")}:</span>{" "}
										{provider}
									</div>
									<div className="text-vscode-descriptionForeground">
										<span className="font-medium">{t("kilocode:ghost.settings.model")}:</span>{" "}
										{model}
									</div>
								</>
							) : (
								<div className="text-vscode-errorForeground">
									{t("kilocode:ghost.settings.noModelConfigured")}
								</div>
							)}
							{MODEL_SELECTION_ENABLED && (
								<div className="text-vscode-descriptionForeground mt-2">
									{t("kilocode:ghost.settings.configureAutocompleteProfile")}
								</div>
							)}
						</div>
					</div>
				</div>
			</Section>
		</div>
	)
}
