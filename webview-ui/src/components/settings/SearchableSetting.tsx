import { HTMLAttributes, useEffect } from "react"

import { cn } from "@/lib/utils"

import { SectionName } from "./SettingsView"
import { useSearchIndexContext } from "./useSettingsSearch"

interface SearchableSettingProps extends HTMLAttributes<HTMLDivElement> {
	/**
	 * Unique identifier for this setting.
	 * Used for finding the element after tab navigation.
	 */
	settingId: string
	/**
	 * The section/tab this setting belongs to.
	 * Used for navigation when the setting is selected from search results.
	 */
	section: SectionName
	/**
	 * The label text for this setting, used for search matching.
	 * This should be the translated label text.
	 */
	label: string
	children: React.ReactNode
}

/**
 * Wrapper component that marks a setting as searchable.
 *
 * The component registers itself with the search index context on mount,
 * allowing the search system to index settings as they are rendered.
 *
 * @example
 * ```tsx
 * <SearchableSetting
 *   settingId="browser-enable"
 *   section="browser"
 *   label={t("settings:browser.enable.label")}
 * >
 *   <VSCodeCheckbox>
 *     <span className="font-medium">{t("settings:browser.enable.label")}</span>
 *   </VSCodeCheckbox>
 *   <div className="text-vscode-descriptionForeground text-sm">
 *     {t("settings:browser.enable.description")}
 *   </div>
 * </SearchableSetting>
 * ```
 */
export function SearchableSetting({
	settingId,
	section,
	label,
	children,
	className,
	...props
}: SearchableSettingProps) {
	const searchContext = useSearchIndexContext()

	// Register this setting with the search index on mount
	// Note: We don't unregister on unmount because settings are indexed once
	// during the initial tab cycling phase and remain in the index
	useEffect(() => {
		if (searchContext) {
			searchContext.registerSetting({ settingId, section, label })
		}
	}, [searchContext, settingId, section, label])

	return (
		<div
			data-searchable
			data-setting-id={settingId}
			data-setting-section={section}
			data-setting-label={label}
			className={cn(className)}
			{...props}>
			{children}
		</div>
	)
}
