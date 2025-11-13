//kilocode_change - new file
import { HTMLAttributes, useCallback, useMemo } from "react"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { Trans } from "react-i18next"
import { Bot, Zap, Settings } from "lucide-react"
import { cn } from "@/lib/utils"
import { SectionHeader } from "../../settings/SectionHeader"
import { Section } from "../../settings/Section"
import { GhostServiceSettings } from "@roo-code/types"
import { vscode } from "@/utils/vscode"
import { VSCodeCheckbox, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { useKeybindings } from "@/hooks/useKeybindings"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { SelectDropdown } from "../../ui/select-dropdown"
import { MODELS_BY_PROVIDER } from "@roo-code/types"

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
	const { listApiConfigMeta } = useExtensionState()
	
	// Debug: log the profiles
	console.log("[GhostServiceSettings] listApiConfigMeta:", listApiConfigMeta)
	
	// Debug: log the dropdown options
	const profileOptions = useMemo(() => {
		const opts = [
			{ value: "", label: "Auto-detect (use first available)" },
			...(listApiConfigMeta || []).map((config) => ({
				value: config.id,
				label: config.name,
			})),
		]
		console.log("[GhostServiceSettings] Profile dropdown options:", opts)
		return opts
	}, [listApiConfigMeta])
	
	const {
		enableAutoTrigger,
		enableQuickInlineTaskKeybinding,
		enableSmartInlineTaskKeybinding,
		useNewAutocomplete,
		provider,
		model,
		autocompleteProfileId,
		autocompleteProvider,
		autocompleteModel,
	} = ghostServiceSettings || {}
	const keybindings = useKeybindings(["kilo-code.addToContextAndFocus", "kilo-code.ghost.generateSuggestions"])

	// Get the selected profile details
	const selectedProfile = useMemo(() => {
		if (!autocompleteProfileId) return null
		return listApiConfigMeta?.find((config) => config.id === autocompleteProfileId)
	}, [autocompleteProfileId, listApiConfigMeta])

	// Get available providers for dropdown
	const providerOptions = useMemo(() => {
		return Object.entries(MODELS_BY_PROVIDER).map(([key, value]) => ({
			value: key,
			label: value.label,
		}))
	}, [])

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

	const onAutocompleteProfileChange = useCallback(
		(profileId: string) => {
			onGhostServiceSettingsChange("autocompleteProfileId", profileId || undefined)
		},
		[onGhostServiceSettingsChange],
	)

	const onAutocompleteProviderChange = useCallback(
		(provider: string) => {
			onGhostServiceSettingsChange("autocompleteProvider", provider || undefined)
		},
		[onGhostServiceSettingsChange],
	)

	const onAutocompleteModelChange = useCallback(
		(e: any) => {
			onGhostServiceSettingsChange("autocompleteModel", e.target.value || undefined)
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

					{process.env.NODE_ENV === "development" && (
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
							<Settings className="w-4" />
							<div>Autocomplete Configuration</div>
						</div>
					</div>

					<div className="flex flex-col gap-3">
						<div className="flex flex-col gap-2">
							<label className="text-sm font-medium">Profile</label>
							<SelectDropdown
								value={autocompleteProfileId || ""}
								onChange={onAutocompleteProfileChange}
								options={profileOptions}
								placeholder="Select profile..."
							/>
							<div className="text-vscode-descriptionForeground text-xs">
								Select a specific profile to use for autocomplete, or leave as auto-detect to use the
								first available profile with a supported provider.
							</div>
						</div>

						{autocompleteProfileId && (
							<>
								<div className="flex flex-col gap-2">
									<label className="text-sm font-medium">Provider Override (Optional)</label>
									<SelectDropdown
										value={autocompleteProvider || ""}
										onChange={onAutocompleteProviderChange}
										options={[
											{
												value: "",
												label: `Use profile default (${selectedProfile?.apiProvider || "none"})`,
											},
											...providerOptions,
										]}
										placeholder="Select provider..."
									/>
									<div className="text-vscode-descriptionForeground text-xs">
										Override the provider from the selected profile. Leave empty to use the
										profile's configured provider.
									</div>
								</div>

								<div className="flex flex-col gap-2">
									<label className="text-sm font-medium">Model Override (Optional)</label>
									<VSCodeTextField
										value={autocompleteModel || ""}
										onInput={onAutocompleteModelChange}
										placeholder={`Use profile default (${selectedProfile?.modelId || "auto"})`}
									/>
									<div className="text-vscode-descriptionForeground text-xs">
										Override the model from the selected profile. Leave empty to use the profile's
										configured model or auto-detect.
									</div>
								</div>
							</>
						)}
					</div>

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
						</div>
					</div>
				</div>
			</Section>
		</div>
	)
}
