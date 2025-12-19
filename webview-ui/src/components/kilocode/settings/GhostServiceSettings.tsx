//kilocode_change - new file
import { useKeybindings } from "@/hooks/useKeybindings"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { cn } from "@/lib/utils"
import { vscode } from "@/utils/vscode"
import { GhostServiceSettings } from "@roo-code/types"
import { Bot, Zap } from "lucide-react"
import { HTMLAttributes } from "react"
import { Trans } from "react-i18next"
import { Section } from "../../settings/Section"
import { SectionHeader } from "../../settings/SectionHeader"
import { SetCachedStateField } from "../../settings/types"
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
	const { enableAutoTrigger, enableQuickInlineTaskKeybinding, enableSmartInlineTaskKeybinding } =
		ghostServiceSettings || {}
	const keybindings = useKeybindings(["axon-code.addToContextAndFocus", "axon-code.ghost.generateSuggestions"])

	const onEnableAutoTriggerChange = (newValue: boolean) => {
		setCachedStateField("ghostServiceSettings", {
			...ghostServiceSettings,
			enableAutoTrigger: newValue,
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
						<ControlledCheckbox checked={enableAutoTrigger ?? true} onChange={onEnableAutoTriggerChange}>
							<span className="font-medium">{t("kilocode:ghost.settings.enableAutoTrigger.label")}</span>
						</ControlledCheckbox>
						<div className="text-vscode-descriptionForeground text-sm mt-1">
							<Trans i18nKey="kilocode:ghost.settings.enableAutoTrigger.description" />
						</div>
					</div>

					<div className="flex flex-col gap-1">
						<ControlledCheckbox
							checked={enableQuickInlineTaskKeybinding || false}
							onChange={onEnableQuickInlineTaskKeybindingChange}>
							<span className="font-medium">
								{t("kilocode:ghost.settings.enableQuickInlineTaskKeybinding.label", {
									keybinding: keybindings["axon-code.addToContextAndFocus"],
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
											onClick={() => openGlobalKeybindings("axon-code.addToContextAndFocus")}
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
									keybinding: keybindings["axon-code.ghost.generateSuggestions"],
								})}
							</span>
						</ControlledCheckbox>
						<div className="text-vscode-descriptionForeground text-sm mt-1">
							<Trans
								i18nKey="kilocode:ghost.settings.enableSmartInlineTaskKeybinding.description"
								values={{ keybinding: keybindings["axon-code.ghost.generateSuggestions"] }}
								components={{
									DocsLink: (
										<a
											href="#"
											onClick={() => openGlobalKeybindings("axon-code.ghost.generateSuggestions")}
											className="text-[var(--vscode-list-highlightForeground)] hover:underline cursor-pointer"></a>
									),
								}}
							/>
						</div>
					</div>
					{/* 
					<div className="flex flex-col gap-1">
						<div className="flex items-center gap-2 font-bold">
							<Bot className="w-4" />
							<div>{t("kilocode:ghost.settings.model")}</div>
						</div>
					</div> */}

					{/* <div className="flex flex-col gap-2">
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
					</div> */}
				</div>
			</Section>
		</div>
	)
}
