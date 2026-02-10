import { useMemo } from "react"
import type { LucideIcon } from "lucide-react"

import { useAppTranslation } from "@/i18n/TranslationContext"
import { cn } from "@/lib/utils"

import { SectionName } from "./SettingsView"
import { SearchResult } from "./useSettingsSearch"

export interface SettingsSearchResultsProps {
	results: SearchResult[]
	query: string
	onSelectResult: (result: SearchResult) => void
	sections: { id: SectionName; icon: LucideIcon }[]
	highlightedResultId?: string
}

interface HighlightMatchProps {
	text: string
	/** Character positions to highlight (from fzf) */
	positions: Set<number>
}

/**
 * Highlights matching characters using fzf's position data.
 */
function HighlightMatch({ text, positions }: HighlightMatchProps) {
	if (positions.size === 0) {
		return <>{text}</>
	}

	// Build segments of highlighted and non-highlighted text
	const segments: { text: string; highlighted: boolean }[] = []
	let currentSegment = ""
	let currentHighlighted = positions.has(0)

	for (let i = 0; i < text.length; i++) {
		const isHighlighted = positions.has(i)
		if (isHighlighted === currentHighlighted) {
			currentSegment += text[i]
		} else {
			if (currentSegment) {
				segments.push({ text: currentSegment, highlighted: currentHighlighted })
			}
			currentSegment = text[i]
			currentHighlighted = isHighlighted
		}
	}

	if (currentSegment) {
		segments.push({ text: currentSegment, highlighted: currentHighlighted })
	}

	return (
		<>
			{segments.map((segment, index) =>
				segment.highlighted ? (
					<mark key={index} className="bg-transparent font-semibold text-inherit">
						{segment.text}
					</mark>
				) : (
					<span key={index}>{segment.text}</span>
				),
			)}
		</>
	)
}

export function SettingsSearchResults({
	results,
	query,
	onSelectResult,
	sections,
	highlightedResultId,
}: SettingsSearchResultsProps) {
	const { t } = useAppTranslation()

	// Group results by section/tab
	const groupedResults = useMemo(() => {
		return results.reduce(
			(acc, result) => {
				const section = result.section
				if (!acc[section]) {
					acc[section] = []
				}
				acc[section].push(result)
				return acc
			},
			{} as Record<SectionName, SearchResult[]>,
		)
	}, [results])

	// Create a map of section id to icon for quick lookup
	const sectionIconMap = useMemo(() => {
		return new Map(sections.map((section) => [section.id, section.icon]))
	}, [sections])

	// If no results, show a message
	if (results.length === 0) {
		return (
			<div className="max-h-80 overflow-y-auto p-4 text-vscode-descriptionForeground text-sm">
				{t("settings:search.noResults", { query })}
			</div>
		)
	}

	return (
		<div className="max-h-80 overflow-y-auto" role="listbox">
			{Object.entries(groupedResults).map(([section, sectionResults]) => {
				const Icon = sectionIconMap.get(section as SectionName)

				return (
					<div key={section}>
						{/* Section header */}
						<div className="flex items-center gap-2 px-3 py-1.5 mt-4 first:mt-0 text-xs text-vscode-descriptionForeground bg-vscode-sideBar-background border-b-vscode-panel-border sticky top-0">
							{Icon && <Icon className="h-3.5 w-3.5" />}
							<span>{t(`settings:sections.${section}`)}</span>
						</div>

						{/* Result items */}
						{sectionResults.map((result) => {
							const isHighlighted = highlightedResultId === result.settingId
							const resultDomId = `settings-search-result-${result.settingId}`

							return (
								<button
									key={result.settingId}
									id={resultDomId}
									type="button"
									role="option"
									aria-selected={isHighlighted}
									onMouseDown={(event) => event.preventDefault()}
									onClick={() => onSelectResult(result)}
									className={cn(
										"w-full cursor-pointer text-left px-3 py-2 hover:bg-vscode-list-hoverBackground focus:bg-vscode-list-hoverBackground focus:outline-none",
										isHighlighted &&
											"bg-vscode-button-background text-vscode-button-foreground hover:bg-vscode-button-hoverBackground",
									)}>
									<div className="text-sm">
										<HighlightMatch text={result.label} positions={result.positions} />
									</div>
								</button>
							)
						})}
					</div>
				)
			})}
		</div>
	)
}
