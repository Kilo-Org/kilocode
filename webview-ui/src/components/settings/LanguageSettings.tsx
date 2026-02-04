import { HTMLAttributes } from "react"
import { useAppTranslation } from "@/i18n/TranslationContext"

import type { Language } from "@roo-code/types"

import { LANGUAGES } from "@roo/language"

import { cn } from "@src/lib/utils"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@src/components/ui"

import { SetCachedStateField } from "./types"
import { SectionHeader } from "./SectionHeader"
import { Section } from "./Section"
import { SearchableSetting } from "./SearchableSetting"

type LanguageSettingsProps = HTMLAttributes<HTMLDivElement> & {
	language: string
	setCachedStateField: SetCachedStateField<"language">
}

// kilocode_change start: sort languages
function getSortedLanguages() {
	return Object.entries(LANGUAGES).toSorted((a, b) => a[0].localeCompare(b[0]))
}
// kilocode_change end

export const LanguageSettings = ({ language, setCachedStateField, className, ...props }: LanguageSettingsProps) => {
	const { t } = useAppTranslation()

	return (
		<div className={cn("flex flex-col gap-2", className)} {...props}>
			<SectionHeader>{t("settings:sections.language")}</SectionHeader>

			<Section>
				<SearchableSetting
					settingId="language-select"
					section="language"
					label={t("settings:sections.language")}>
					<Select
						value={language}
						onValueChange={(value) => setCachedStateField("language", value as Language)}>
						<SelectTrigger className="w-full">
							<SelectValue placeholder={t("settings:common.select")} />
						</SelectTrigger>
						<SelectContent>
							<SelectGroup>
								{Object.entries(LANGUAGES).map(([code, name]) => (
									<SelectItem key={code} value={code}>
										{name}
										<span className="text-muted-foreground">({code})</span>
									</SelectItem>
								))}
							</SelectGroup>
						</SelectContent>
					</Select>
				</SearchableSetting>
			</Section>
		</div>
	)
}
