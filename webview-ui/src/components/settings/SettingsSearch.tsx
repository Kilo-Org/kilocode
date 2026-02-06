import { useRef, useEffect, useState, useCallback } from "react"
import type { LucideIcon } from "lucide-react"

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useSettingsSearch, SearchResult, SearchableSettingData } from "./useSettingsSearch"
import { SectionName } from "./SettingsView"
import { SettingsSearchInput } from "./SettingsSearchInput"
import { SettingsSearchResults } from "./SettingsSearchResults"

interface SettingsSearchProps {
	index: SearchableSettingData[]
	onNavigate: (section: SectionName, settingId: string) => void
	sections: { id: SectionName; icon: LucideIcon }[]
}

export function SettingsSearch({ index, onNavigate, sections }: SettingsSearchProps) {
	const inputRef = useRef<HTMLInputElement>(null)
	const { searchQuery, setSearchQuery, results, isOpen, setIsOpen, clearSearch } = useSettingsSearch({ index })
	const [highlightedResultId, setHighlightedResultId] = useState<string | undefined>(undefined)

	// Handle selection of a search result
	const handleSelectResult = useCallback(
		(result: SearchResult) => {
			onNavigate(result.section, result.settingId)
			clearSearch()
			setHighlightedResultId(undefined)
			// Keep focus in the input so dropdown remains open for follow-up search
			setIsOpen(true)
			requestAnimationFrame(() => inputRef.current?.focus())
		},
		[onNavigate, clearSearch, setIsOpen],
	)

	// Keyboard navigation inside search results
	const moveHighlight = useCallback(
		(direction: 1 | -1) => {
			if (!results.length) return
			const flatIds = results.map((r) => r.settingId)
			const currentIndex = highlightedResultId ? flatIds.indexOf(highlightedResultId) : -1
			const nextIndex = (currentIndex + direction + flatIds.length) % flatIds.length
			setHighlightedResultId(flatIds[nextIndex])
		},
		[highlightedResultId, results],
	)

	const handleSearchKeyDown = useCallback(
		(event: React.KeyboardEvent<HTMLInputElement>) => {
			if (event.key === "Escape") {
				setIsOpen(false)
				setHighlightedResultId(undefined)
				inputRef.current?.blur()
				return
			}

			if (!results.length) return

			if (event.key === "ArrowDown") {
				event.preventDefault()
				moveHighlight(1)
				return
			}

			if (event.key === "ArrowUp") {
				event.preventDefault()
				moveHighlight(-1)
				return
			}

			if (event.key === "Enter" && highlightedResultId) {
				event.preventDefault()
				const selected = results.find((r) => r.settingId === highlightedResultId)
				if (selected) {
					handleSelectResult(selected)
				}
				return
			}
		},
		[handleSelectResult, highlightedResultId, moveHighlight, results, setIsOpen],
	)

	// Reset highlight based on focus and available results
	useEffect(() => {
		if (!isOpen || !results.length) {
			setHighlightedResultId(undefined)
			return
		}

		setHighlightedResultId((current) =>
			current && results.some((r) => r.settingId === current) ? current : results[0]?.settingId,
		)
	}, [isOpen, results])

	// Ensure highlighted search result stays visible within dropdown
	useEffect(() => {
		if (!highlightedResultId || !isOpen) return

		const element = document.getElementById(`settings-search-result-${highlightedResultId}`)
		element?.scrollIntoView({ block: "nearest" })
	}, [highlightedResultId, isOpen])

	return (
		<Popover open={searchQuery !== "" && isOpen} modal={false}>
			<PopoverTrigger asChild>
				<div className="relative justify-end">
					<SettingsSearchInput
						value={searchQuery}
						onChange={setSearchQuery}
						onFocus={() => setIsOpen(true)}
						onKeyDown={handleSearchKeyDown}
						inputRef={inputRef}
					/>
				</div>
			</PopoverTrigger>
			<PopoverContent
				className="min-w-[300px] p-0 border-vscode-dropdown-border bg-vscode-dropdown-background rounded-2xl overflow-hidden shadow-xl"
				align="end"
				side="bottom"
				sideOffset={8}
				onOpenAutoFocus={(e) => e.preventDefault()}
				onCloseAutoFocus={(e) => e.preventDefault()}>
				<SettingsSearchResults
					results={results}
					query={searchQuery}
					onSelectResult={handleSelectResult}
					sections={sections}
					highlightedResultId={highlightedResultId}
				/>
			</PopoverContent>
		</Popover>
	)
}
