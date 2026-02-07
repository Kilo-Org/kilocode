import { useState, useMemo, useCallback, useRef, createContext, useContext } from "react"
import { Fzf } from "fzf"

import { SectionName } from "./SettingsView"

export interface SearchableSettingData {
	settingId: string
	section: SectionName
	label: string
	sectionLabel: string
}

export interface SearchResult {
	settingId: string
	section: SectionName
	label: string
	sectionLabel: string
	/** Character positions that matched the search query (for highlighting) */
	positions: Set<number>
}

/**
 * Context for collecting searchable settings as they mount.
 * This allows building the search index without rendering all sections.
 */
interface SearchIndexContextValue {
	registerSetting: (setting: Omit<SearchableSettingData, "sectionLabel">) => void
}

const SearchIndexContext = createContext<SearchIndexContextValue | null>(null)

export const SearchIndexProvider = SearchIndexContext.Provider

export function useSearchIndexContext() {
	return useContext(SearchIndexContext)
}

/**
 * Hook to create a search index registry.
 * Returns the context value and the current index.
 */
export function useSearchIndexRegistry(getSectionLabel: (section: SectionName) => string) {
	const settingsRef = useRef<Map<string, Omit<SearchableSettingData, "sectionLabel">>>(new Map())
	const [index, setIndex] = useState<SearchableSettingData[]>([])
	const updateScheduled = useRef(false)

	const scheduleUpdate = useCallback(() => {
		if (updateScheduled.current) return
		updateScheduled.current = true

		// Batch updates to avoid frequent re-renders
		requestAnimationFrame(() => {
			const settings = Array.from(settingsRef.current.values()).map((s) => ({
				...s,
				sectionLabel: getSectionLabel(s.section),
			}))
			setIndex(settings)
			updateScheduled.current = false
		})
	}, [getSectionLabel])

	const contextValue = useMemo<SearchIndexContextValue>(
		() => ({
			registerSetting: (setting) => {
				settingsRef.current.set(setting.settingId, setting)
				scheduleUpdate()
			},
		}),
		[scheduleUpdate],
	)

	return { contextValue, index }
}

/**
 * Scan the DOM for searchable settings within a container.
 * This is called once on mount to build the index.
 */
export function scanDOMForSearchableSettings(
	container: Element,
	getSectionLabel: (section: SectionName) => string,
): SearchableSettingData[] {
	const settings: SearchableSettingData[] = []
	const elements = container.querySelectorAll("[data-searchable]")

	elements.forEach((el) => {
		const settingId = el.getAttribute("data-setting-id")
		const section = el.getAttribute("data-setting-section") as SectionName | null
		const label = el.getAttribute("data-setting-label")

		if (settingId && section && label) {
			settings.push({
				settingId,
				section,
				label,
				sectionLabel: getSectionLabel(section),
			})
		}
	})

	return settings
}

interface UseSettingsSearchOptions {
	index: SearchableSettingData[]
}

/**
 * Hook for searching settings using fuzzy matching.
 */
export function useSettingsSearch({ index }: UseSettingsSearchOptions) {
	const [searchQuery, setSearchQuery] = useState("")
	const [isOpen, setIsOpen] = useState(false)

	// Create Fzf instance for fuzzy searching
	const fzf = useMemo(
		() =>
			new Fzf(index, {
				selector: (item) => `${item.label} ${item.sectionLabel}`,
			}),
		[index],
	)

	// Search results
	const results = useMemo((): SearchResult[] => {
		if (!searchQuery.trim()) {
			return []
		}

		const fzfResults = fzf.find(searchQuery)
		return fzfResults.slice(0, 10).map((result) => ({
			settingId: result.item.settingId,
			section: result.item.section,
			label: result.item.label,
			sectionLabel: result.item.sectionLabel,
			positions: result.positions,
		}))
	}, [fzf, searchQuery])

	const clearSearch = useCallback(() => {
		setSearchQuery("")
		setIsOpen(false)
	}, [])

	return {
		searchQuery,
		setSearchQuery,
		results,
		isOpen,
		setIsOpen,
		clearSearch,
	}
}
