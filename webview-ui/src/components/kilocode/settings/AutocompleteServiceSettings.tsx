//kilocode_change - new file
import { HTMLAttributes, useCallback, useEffect, useMemo, useState } from "react"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { Trans } from "react-i18next"
import { Bot, Zap, Clock } from "lucide-react"
import { cn } from "@/lib/utils"
import { SectionHeader } from "../../settings/SectionHeader"
import { Section } from "../../settings/Section"
import { SearchableSetting } from "../../settings/SearchableSetting"
import {
	AUTOCOMPLETE_PROVIDER_MODELS,
	EXTREME_SNOOZE_VALUES_ENABLED,
	AutocompleteServiceSettings,
	MODEL_SELECTION_ENABLED,
} from "@roo-code/types"
import { vscode } from "@/utils/vscode"
import { VSCodeCheckbox, VSCodeButton, VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react"
import { useKeybindings } from "@/hooks/useKeybindings"
import { useExtensionState } from "../../../context/ExtensionStateContext"
import { PROVIDERS } from "../../settings/constants"

type AutocompleteServiceSettingsViewProps = HTMLAttributes<HTMLDivElement> & {
	ghostServiceSettings: AutocompleteServiceSettings
	onAutocompleteServiceSettingsChange: <K extends keyof NonNullable<AutocompleteServiceSettings>>(
		field: K,
		value: NonNullable<AutocompleteServiceSettings>[K],
	) => void
}

// Get the list of supported provider keys from AUTOCOMPLETE_PROVIDER_MODELS
const SUPPORTED_AUTOCOMPLETE_PROVIDER_KEYS = Array.from(AUTOCOMPLETE_PROVIDER_MODELS.keys())
const AUTOCOMPLETE_SERVICE_KEYBINDING_COMMAND_IDS = ["kilo-code.autocomplete.generateSuggestions"]

export const AutocompleteServiceSettingsView = ({
	ghostServiceSettings,
	onAutocompleteServiceSettingsChange,
	className,
	...props
}: AutocompleteServiceSettingsViewProps) => {
	const { t } = useAppTranslation()
	const { kiloCodeWrapperProperties } = useExtensionState()
	const {
		enableAutoTrigger,
		enableSmartInlineTaskKeybinding,
		enableChatAutocomplete,
		provider,
		model,
		hasKilocodeProfileWithNoBalance,
	} = ghostServiceSettings || {}
	const keybindings = useKeybindings(AUTOCOMPLETE_SERVICE_KEYBINDING_COMMAND_IDS)
	const [snoozeDuration, setSnoozeDuration] = useState<number>(300)
	const [currentTime, setCurrentTime] = useState<number>(Date.now())

	// Get friendly display names for supported autocomplete providers
	const supportedProviderNames = useMemo(() => {
		return SUPPORTED_AUTOCOMPLETE_PROVIDER_KEYS.map((key) => {
			const provider = PROVIDERS.find((p) => p.value === key)
			return provider?.label ?? key
		})
	}, [])

	useEffect(() => {
		const interval = setInterval(() => {
			setCurrentTime(Date.now())
		}, 30_000)

		return () => clearInterval(interval)
	}, [])

	const snoozeUntil = ghostServiceSettings?.snoozeUntil
	const isSnoozed = snoozeUntil ? currentTime < snoozeUntil : false

	const onEnableAutoTriggerChange = useCallback(
		(e: any) => {
			onAutocompleteServiceSettingsChange("enableAutoTrigger", e.target.checked)
		},
		[onAutocompleteServiceSettingsChange],
	)

	const onEnableSmartInlineTaskKeybindingChange = useCallback(
		(e: any) => {
			onAutocompleteServiceSettingsChange("enableSmartInlineTaskKeybinding", e.target.checked)
		},
		[onAutocompleteServiceSettingsChange],
	)

	const onEnableChatAutocompleteChange = useCallback(
		(e: any) => {
			onAutocompleteServiceSettingsChange("enableChatAutocomplete", e.target.checked)
		},
		[onAutocompleteServiceSettingsChange],
	)

	const openGlobalKeybindings = (filter?: string) => {
		vscode.postMessage({ type: "openGlobalKeybindings", text: filter })
	}

	const handleSnooze = useCallback(() => {
		vscode.postMessage({ type: "snoozeAutocomplete", value: snoozeDuration })
	}, [snoozeDuration])

	const handleUnsnooze = useCallback(() => {
		vscode.postMessage({ type: "snoozeAutocomplete", value: 0 })
	}, [])

	return (
		<div className={cn("flex flex-col", className)} {...props}>
			<SectionHeader>
				<div className="flex items-center gap-2">
					<Bot className="w-4" />
					<div>{t("kilocode:autocomplete.title")}</div>
				</div>
			</SectionHeader>

			<Section className="flex flex-col gap-5">
				<div className="flex flex-col gap-3">
					<div className="flex flex-col gap-1">
						<div className="flex items-center gap-2 font-bold">
							<Zap className="w-4" />
							<div>{t("kilocode:autocomplete.settings.codeEditorSuggestions")}</div>
						</div>
					</div>

					<SearchableSetting
						settingId="autocomplete-enable-auto-trigger"
						section="autocomplete"
						label={t("kilocode:autocomplete.settings.enableAutoTrigger.label")}
						className="flex flex-col gap-1">
						<VSCodeCheckbox checked={enableAutoTrigger || false} onChange={onEnableAutoTriggerChange}>
							<span className="font-medium">
								{t("kilocode:autocomplete.settings.enableAutoTrigger.label")}
							</span>
						</VSCodeCheckbox>
						<div className="text-vscode-descriptionForeground text-sm mt-1">
							{t("kilocode:autocomplete.settings.enableAutoTrigger.description")}
						</div>
					</SearchableSetting>

					{enableAutoTrigger && (
						<SearchableSetting
							settingId="autocomplete-snooze"
							section="autocomplete"
							label={t("kilocode:autocomplete.settings.snooze.label")}
							className="flex flex-col gap-2 mt-2 ml-6">
							<div className="flex items-center gap-2">
								<Clock className="w-4" />
								<span className="font-medium">{t("kilocode:autocomplete.settings.snooze.label")}</span>
							</div>
							{isSnoozed ? (
								<div className="flex items-center gap-2">
									<span className="text-vscode-descriptionForeground text-sm">
										{t("kilocode:autocomplete.settings.snooze.currentlySnoozed")}
									</span>
									<VSCodeButton appearance="secondary" onClick={handleUnsnooze}>
										{t("kilocode:autocomplete.settings.snooze.unsnooze")}
									</VSCodeButton>
								</div>
							) : (
								<div className="flex items-center gap-2">
									<VSCodeDropdown
										value={snoozeDuration.toString()}
										onChange={(e: any) => setSnoozeDuration(Number(e.target.value))}>
										{EXTREME_SNOOZE_VALUES_ENABLED && (
											<VSCodeOption value="60">
												{t("kilocode:autocomplete.settings.snooze.duration.1min")}
											</VSCodeOption>
										)}
										<VSCodeOption value="300">
											{t("kilocode:autocomplete.settings.snooze.duration.5min")}
										</VSCodeOption>
										<VSCodeOption value="900">
											{t("kilocode:autocomplete.settings.snooze.duration.15min")}
										</VSCodeOption>
										<VSCodeOption value="1800">
											{t("kilocode:autocomplete.settings.snooze.duration.30min")}
										</VSCodeOption>
										<VSCodeOption value="3600">
											{t("kilocode:autocomplete.settings.snooze.duration.1hour")}
										</VSCodeOption>
									</VSCodeDropdown>
									<VSCodeButton appearance="secondary" onClick={handleSnooze}>
										{t("kilocode:autocomplete.settings.snooze.button")}
									</VSCodeButton>
								</div>
							)}
							<div className="text-vscode-descriptionForeground text-sm">
								{t("kilocode:autocomplete.settings.snooze.description")}
							</div>
						</SearchableSetting>
					)}

					{!kiloCodeWrapperProperties?.kiloCodeWrapped && (
						<SearchableSetting
							settingId="autocomplete-smart-inline-task-keybinding"
							section="autocomplete"
							label={t("kilocode:autocomplete.settings.enableSmartInlineTaskKeybinding.label", {
								keybinding: keybindings["kilo-code.autocomplete.generateSuggestions"],
							})}
							className="flex flex-col gap-1">
							<VSCodeCheckbox
								checked={enableSmartInlineTaskKeybinding || false}
								onChange={onEnableSmartInlineTaskKeybindingChange}>
								<span className="font-medium">
									{t("kilocode:autocomplete.settings.enableSmartInlineTaskKeybinding.label", {
										keybinding: keybindings["kilo-code.autocomplete.generateSuggestions"],
									})}
								</span>
							</VSCodeCheckbox>
							<div className="text-vscode-descriptionForeground text-sm mt-1">
								<Trans
									i18nKey="kilocode:autocomplete.settings.enableSmartInlineTaskKeybinding.description"
									values={{ keybinding: keybindings["kilo-code.autocomplete.generateSuggestions"] }}
									components={{
										DocsLink: (
											<a
												href="#"
												onClick={() =>
													openGlobalKeybindings("kilo-code.autocomplete.generateSuggestions")
												}
												className="text-[var(--vscode-list-highlightForeground)] hover:underline cursor-pointer"></a>
										),
									}}
								/>
							</div>
						</SearchableSetting>
					)}

					<div className="flex flex-col gap-1">
						<div className="flex items-center gap-2 font-bold">
							<Bot className="w-4" />
							<div>{t("kilocode:autocomplete.settings.chatSuggestions")}</div>
						</div>
					</div>

					<SearchableSetting
						settingId="autocomplete-chat-autocomplete"
						section="autocomplete"
						label={t("kilocode:autocomplete.settings.enableChatAutocomplete.label")}
						className="flex flex-col gap-1">
						<VSCodeCheckbox
							checked={enableChatAutocomplete || false}
							onChange={onEnableChatAutocompleteChange}>
							<span className="font-medium">
								{t("kilocode:autocomplete.settings.enableChatAutocomplete.label")}
							</span>
						</VSCodeCheckbox>
						<div className="text-vscode-descriptionForeground text-sm mt-1">
							<Trans i18nKey="kilocode:autocomplete.settings.enableChatAutocomplete.description" />
						</div>
					</SearchableSetting>

					<SearchableSetting
						settingId="autocomplete-model"
						section="autocomplete"
						label={t("kilocode:autocomplete.settings.model")}
						className="flex flex-col gap-2">
						<div className="flex flex-col gap-1">
							<div className="flex items-center gap-2 font-bold">
								<Bot className="w-4" />
								<div>{t("kilocode:autocomplete.settings.model")}</div>
							</div>
						</div>

						<div className="text-sm">
							{provider && model ? (
								<>
									<div className="text-vscode-descriptionForeground">
										<span className="font-medium">
											{t("kilocode:autocomplete.settings.provider")}:
										</span>{" "}
										{provider}
									</div>
									<div className="text-vscode-descriptionForeground">
										<span className="font-medium">
											{t("kilocode:autocomplete.settings.model")}:
										</span>{" "}
										{model}
									</div>
								</>
							) : hasKilocodeProfileWithNoBalance ? (
								<div className="flex flex-col gap-2">
									<div className="text-vscode-errorForeground font-medium">
										{t("kilocode:autocomplete.settings.noCredits.title")}
									</div>
									<div className="text-vscode-descriptionForeground">
										{t("kilocode:autocomplete.settings.noCredits.description")}
									</div>
									<div className="text-vscode-descriptionForeground">
										<a
											href="https://kilo.ai/credits"
											className="text-vscode-textLink-foreground hover:underline">
											{t("kilocode:autocomplete.settings.noCredits.buyCredits")}
										</a>
									</div>
								</div>
							) : (
								<div className="flex flex-col gap-2">
									<div className="text-vscode-errorForeground font-medium">
										{t("kilocode:autocomplete.settings.noModelConfigured.title")}
									</div>
									<div className="text-vscode-descriptionForeground">
										{t("kilocode:autocomplete.settings.noModelConfigured.description")}
									</div>
									<ul className="text-vscode-descriptionForeground list-disc list-inside ml-2">
										{supportedProviderNames.map((name) => (
											<li key={name}>{name}</li>
										))}
									</ul>
									<div className="text-vscode-descriptionForeground">
										<a
											href="https://kilo.ai/docs/basic-usage/autocomplete"
											className="text-vscode-textLink-foreground hover:underline">
											{t("kilocode:autocomplete.settings.noModelConfigured.learnMore")}
										</a>
									</div>
								</div>
							)}
							{MODEL_SELECTION_ENABLED && (
								<div className="text-vscode-descriptionForeground mt-2">
									{t("kilocode:autocomplete.settings.configureAutocompleteProfile")}
								</div>
							)}
						</div>
					</SearchableSetting>
				</div>
			</Section>
		</div>
	)
}
