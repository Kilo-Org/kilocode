import { HTMLAttributes } from "react"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { Bot, Webhook } from "lucide-react"
import { cn } from "@/lib/utils"
import { useExtensionState } from "../../../context/ExtensionStateContext"
import { SectionHeader } from "../../settings/SectionHeader"
import { Section } from "../../settings/Section"
import { GhostServiceSettings } from "@roo-code/types"
import { SetCachedStateField } from "../../settings/types"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@src/components/ui"

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

	const { apiConfigId } = ghostServiceSettings || {}
	const { listApiConfigMeta } = useExtensionState()

	const onApiConfigIdChange = (value: string) => {
		setCachedStateField("ghostServiceSettings", {
			...ghostServiceSettings,
			apiConfigId: value === "-" ? "" : value,
		})
	}

	return (
		<div className={cn("flex flex-col", className)} {...props}>
			<SectionHeader>
				<div className="flex items-center gap-2">
					<Bot className="w-4" />
					<div>{t("kilocode:ghost.title")}</div>
				</div>
			</SectionHeader>

			<Section>
				{/* Provider Settings */}
				<div className="flex flex-col gap-3">
					<div className="flex flex-col gap-1">
						<div className="flex items-center gap-2 font-bold">
							<Webhook className="w-4" />
							<div>{t("settings:sections.providers")}</div>
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
