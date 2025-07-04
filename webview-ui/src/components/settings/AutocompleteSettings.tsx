import React, { HTMLAttributes } from "react"
import { Zap } from "lucide-react"

import type { ProviderSettingsEntry } from "@roo-code/types"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { cn } from "@src/lib/utils"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@src/components/ui"

type AutocompleteSettingsProps = HTMLAttributes<HTMLDivElement> & {
	autocompleteApiConfigId?: string
	listApiConfigMeta: ProviderSettingsEntry[]
	onAutocompleteApiConfigIdChange: (value: string) => void
}

export const AutocompleteSettings = ({
	autocompleteApiConfigId,
	listApiConfigMeta,
	onAutocompleteApiConfigIdChange,
	className,
	...props
}: AutocompleteSettingsProps) => {
	const { t } = useAppTranslation()

	return (
		<div className={cn("flex flex-col gap-4 p-4 border border-vscode-widget-border rounded", className)} {...props}>
			<div className="flex items-center gap-2">
				<Zap className="w-4 h-4" />
				<h3 className="font-medium">{t("settings:autocomplete.title")}</h3>
			</div>

			<div className="text-sm text-vscode-descriptionForeground">{t("settings:autocomplete.description")}</div>

			<div className="space-y-3">
				<div>
					<label className="block text-sm font-medium mb-1">{t("settings:autocomplete.profile")}</label>
					<Select
						value={autocompleteApiConfigId}
						onValueChange={(value) => onAutocompleteApiConfigIdChange(value)}>
						<SelectTrigger className="w-full">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{listApiConfigMeta.map((config: ProviderSettingsEntry) => (
								<SelectItem key={config.id} value={config.id}>
									{config.name} ({config.apiProvider})
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
			</div>
		</div>
	)
}
