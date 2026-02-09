import React, { memo, useState, useEffect } from "react"
import BottomControls from "../kilocode/BottomControls" // kilocode_change
import { ArrowLeft, Filter, ListChecks, Check, X, Trash2 } from "lucide-react"
import { DeleteTaskDialog } from "./DeleteTaskDialog"
import { BatchDeleteTaskDialog } from "./BatchDeleteTaskDialog"
import { Virtuoso } from "react-virtuoso"

import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"

import {
	Button,
	Checkbox,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui"
import { useAppTranslation } from "@/i18n/TranslationContext"

import { Tab, TabContent, TabHeader } from "../common/Tab"
import { useTaskSearch } from "./useTaskSearch"
import TaskItem from "./TaskItem"

type HistoryViewProps = {
	onDone: () => void
}

type SortOption = "newest" | "oldest" | "mostExpensive" | "mostTokens" | "mostRelevant"

const HistoryView = ({ onDone }: HistoryViewProps) => {
	const {
		data, // kilocode_change
		searchQuery,
		setSearchQuery,
		sortOption,
		setSortOption,
		setLastNonRelevantSort,
		showAllWorkspaces,
		setShowAllWorkspaces,
		// kilocode_change start
		showFavoritesOnly,
		setShowFavoritesOnly,
		setRequestedPageIndex,
		// kilocode_change end
	} = useTaskSearch()
	// kilocode_change start
	const tasks = data?.historyItems ?? []
	const pageIndex = data?.pageIndex ?? 0
	const pageCount = data?.pageCount ?? 1
	const totalItems = data?.totalItems ?? 0
	// kilocode_change end
	const { t } = useAppTranslation()

	const [deleteTaskId, setDeleteTaskId] = useState<string | null>(null)
	const [isSelectionMode, setIsSelectionMode] = useState(false)
	const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([])
	const [showBatchDeleteDialog, setShowBatchDeleteDialog] = useState<boolean>(false)
	const [showFilters, setShowFilters] = useState(false)

	// Clear selections when switching between all/current workspace
	useEffect(() => {
		setSelectedTaskIds([])
	}, [showAllWorkspaces])

	// Clear selections when exiting selection mode
	useEffect(() => {
		if (!isSelectionMode) {
			setSelectedTaskIds([])
		}
	}, [isSelectionMode])

	// Toggle selection mode
	const toggleSelectionMode = () => {
		setIsSelectionMode(!isSelectionMode)
	}

	// Toggle selection for a single task
	const toggleTaskSelection = (taskId: string, isSelected: boolean) => {
		if (isSelected) {
			setSelectedTaskIds((prev) => [...prev, taskId])
		} else {
			setSelectedTaskIds((prev) => prev.filter((id) => id !== taskId))
		}
	}

	// Toggle select all tasks
	const toggleSelectAll = (selectAll: boolean) => {
		if (selectAll) {
			setSelectedTaskIds(tasks.map((task) => task.id))
		} else {
			setSelectedTaskIds([])
		}
	}

	// Handle batch delete button click
	const handleBatchDelete = () => {
		if (selectedTaskIds.length > 0) {
			setShowBatchDeleteDialog(true)
		}
	}

	// Check if all tasks are selected
	const isAllSelected = tasks.length > 0 && selectedTaskIds.length === tasks.length
	// Check if some (but not all) tasks are selected
	const isPartiallySelected = selectedTaskIds.length > 0 && selectedTaskIds.length < tasks.length

	return (
		<Tab>
			<TabHeader className="flex flex-col gap-2">
				{/* Header Row - Simplified */}
				<div className="flex items-center gap-2">
					<Button
						variant="ghost"
						className="px-1.5 -ml-2"
						onClick={onDone}
						aria-label={t("history:done")}
						data-testid="history-done-button">
						<ArrowLeft className="w-5 h-5" />
						<span className="sr-only">{t("history:done")}</span>
					</Button>
					<h3 className="text-vscode-foreground m-0 font-semibold">{t("history:history")}</h3>
				</div>

				{/* Unified Control Bar */}
				<div className="flex items-center gap-2">
					<VSCodeTextField
						className="flex-1"
						placeholder={t("history:searchPlaceholder")}
						value={searchQuery}
						data-testid="history-search-input"
						onInput={(e) => {
							const newValue = (e.target as HTMLInputElement)?.value
							setSearchQuery(newValue)
							if (newValue && !searchQuery && sortOption !== "mostRelevant") {
								setLastNonRelevantSort(sortOption)
								setSortOption("mostRelevant")
							}
						}}>
						<div slot="start" className="codicon codicon-search mt-0.5 opacity-80 text-sm!" />
						{searchQuery && (
							<div
								className="input-icon-button codicon codicon-close flex justify-center items-center h-full"
								aria-label="Clear search"
								onClick={() => setSearchQuery("")}
								slot="end"
							/>
						)}
					</VSCodeTextField>

					{/* Filters Toggle Button - Hidden in selection mode */}
					{!isSelectionMode && (
						<Button
							variant={showFilters ? "primary" : "secondary"}
							size="sm"
							onClick={() => setShowFilters(!showFilters)}
							data-testid="toggle-filters-button"
							className="shrink-0">
							<Filter className="w-4 h-4 mr-1" />
							{t("history:filters")}
							<span className={`ml-1 text-xs transition-transform ${showFilters ? "rotate-180" : ""}`}>▼</span>
						</Button>
					)}

					{/* Selection Mode Toggle Button */}
					<Button
						variant={isSelectionMode ? "primary" : "secondary"}
						size="sm"
						onClick={toggleSelectionMode}
						data-testid="toggle-selection-mode-button"
						className="shrink-0">
						{isSelectionMode ? (
							<>
								<Check className="w-4 h-4 mr-1" />
								{t("history:done")}
							</>
						) : (
							<>
								<ListChecks className="w-4 h-4 mr-1" />
								{t("history:select")}
							</>
						)}
					</Button>
				</div>

				{/* Collapsible Filter Panel */}
				{showFilters && !isSelectionMode && (
					<div className="flex flex-col gap-2 p-2 bg-vscode-editor-inactiveBackground/50 rounded border border-vscode-panel-border">
						<div className="flex gap-2">
							<Select
								value={showAllWorkspaces ? "all" : "current"}
								onValueChange={(value) => setShowAllWorkspaces(value === "all")}>
								<SelectTrigger className="flex-1">
									<SelectValue>
										{t("history:workspace.prefix")}{" "}
										{t(`history:workspace.${showAllWorkspaces ? "all" : "current"}`)}
									</SelectValue>
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="current">
										<div className="flex items-center gap-2">
											<span className="codicon codicon-folder" />
											{t("history:workspace.current")}
										</div>
									</SelectItem>
									<SelectItem value="all">
										<div className="flex items-center gap-2">
											<span className="codicon codicon-folder-opened" />
											{t("history:workspace.all")}
										</div>
									</SelectItem>
								</SelectContent>
							</Select>
							<Select value={sortOption} onValueChange={(value) => setSortOption(value as SortOption)}>
								<SelectTrigger className="flex-1">
									<SelectValue>
										{t("history:sort.prefix")} {t(`history:sort.${sortOption}`)}
									</SelectValue>
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="newest" data-testid="select-newest">
										<div className="flex items-center gap-2">
											<span className="codicon codicon-arrow-down" />
											{t("history:newest")}
										</div>
									</SelectItem>
									<SelectItem value="oldest" data-testid="select-oldest">
										<div className="flex items-center gap-2">
											<span className="codicon codicon-arrow-up" />
											{t("history:oldest")}
										</div>
									</SelectItem>
									<SelectItem value="mostExpensive" data-testid="select-most-expensive">
										<div className="flex items-center gap-2">
											<span className="codicon codicon-credit-card" />
											{t("history:mostExpensive")}
										</div>
									</SelectItem>
									<SelectItem value="mostTokens" data-testid="select-most-tokens">
										<div className="flex items-center gap-2">
											<span className="codicon codicon-symbol-numeric" />
											{t("history:mostTokens")}
										</div>
									</SelectItem>
									<SelectItem
										value="mostRelevant"
										disabled={!searchQuery}
										data-testid="select-most-relevant">
										<div className="flex items-center gap-2">
											<span className="codicon codicon-search" />
											{t("history:mostRelevant")}
										</div>
									</SelectItem>
								</SelectContent>
							</Select>
						</div>

						{/* Favorites Toggle - Modern chip style */}
						<div className="flex items-center gap-2">
							<button
								onClick={() => setShowFavoritesOnly(!showFavoritesOnly)}
								className={`flex items-center gap-1.5 px-2 py-1 rounded text-sm transition-colors ${
									showFavoritesOnly
										? "bg-vscode-button-background text-vscode-button-foreground"
										: "bg-vscode-editor-background text-vscode-foreground hover:bg-vscode-list-hoverBackground border border-vscode-panel-border"
								}`}
								data-testid="favorites-toggle">
								<span className={`codicon ${showFavoritesOnly ? "codicon-star-full" : "codicon-star"}`} />
								{t("history:favoritesOnly")}
							</button>
						</div>
					</div>
				)}

				{/* Selection Toolbar - Shown only in selection mode */}
				{isSelectionMode && tasks.length > 0 && (
					<div className="flex items-center justify-between p-2 bg-vscode-button-background/10 rounded border border-vscode-button-background/30">
						<div className="flex items-center gap-3">
							<Checkbox
								checked={isAllSelected}
								data-state={isPartiallySelected ? "indeterminate" : isAllSelected ? "checked" : "unchecked"}
								onCheckedChange={(checked) => toggleSelectAll(checked === true)}
								variant="description"
								id="select-all-checkbox"
							/>
							<label htmlFor="select-all-checkbox" className="text-vscode-foreground cursor-pointer font-medium">
								{isAllSelected ? t("history:deselectAll") : t("history:selectAll")}
							</label>
						</div>

						<div className="flex items-center gap-3">
							<span className="text-vscode-descriptionForeground text-sm">
								{t("history:selectedItems", {
									selected: selectedTaskIds.length,
									total: totalItems,
								})}
							</span>
						</div>
					</div>
				)}
			</TabHeader>

			<TabContent className="px-2 py-0">
				<Virtuoso
					className="flex-1 overflow-y-scroll"
					data={tasks}
					data-testid="virtuoso-container"
					initialTopMostItemIndex={0}
					components={{
						List: React.forwardRef((props, ref) => (
							<div {...props} ref={ref} data-testid="virtuoso-item-list" />
						)),
					}}
					itemContent={(_index, item) => (
						<TaskItem
							key={item.id}
							item={item}
							variant="full"
							showWorkspace={showAllWorkspaces}
							isSelectionMode={isSelectionMode}
							isSelected={selectedTaskIds.includes(item.id)}
							onToggleSelection={toggleTaskSelection}
							onDelete={setDeleteTaskId}
							className="m-2"
						/>
					)}
				/>
			</TabContent>

			{/* kilocode_change: more nesting so we can add more rows, removed fixed class */}
			<div className="bg-vscode-editor-background">
				{/* Fixed action bar at bottom - only shown in selection mode with selected items */}
				{isSelectionMode && selectedTaskIds.length > 0 && (
					<div className="border-t border-vscode-panel-border p-3 flex justify-between items-center bg-vscode-button-background/10">
						<div className="flex items-center gap-2">
							<span className="text-vscode-foreground font-medium">
								{selectedTaskIds.length} {t("history:selected")}
							</span>
						</div>
						<div className="flex gap-2">
							<Button variant="secondary" size="sm" onClick={() => setSelectedTaskIds([])}>
								<X className="w-4 h-4 mr-1" />
								{t("history:clear")}
							</Button>
							<Button variant="primary" size="sm" onClick={handleBatchDelete}>
								<Trash2 className="w-4 h-4 mr-1" />
								{t("history:delete")}
							</Button>
						</div>
					</div>
				)}
				{
					// kilocode_change start
					<div className="border-t border-b border-vscode-panel-border p-2 flex justify-between items-center">
						{t("kilocode:pagination.page", {
							page: pageIndex + 1,
							count: pageCount,
						})}
						<div className="flex gap-2">
							<Button
								disabled={pageIndex <= 0}
								onClick={() => {
									if (pageIndex > 0) {
										setRequestedPageIndex(pageIndex - 1)
									}
								}}>
								{t("kilocode:pagination.previous")}
							</Button>
							<Button
								disabled={pageIndex >= pageCount - 1}
								onClick={() => {
									if (pageIndex < pageCount - 1) {
										setRequestedPageIndex(pageIndex + 1)
									}
								}}>
								{t("kilocode:pagination.next")}
							</Button>
						</div>
					</div>
					// kilocode_change end
				}
			</div>

			{/* Delete dialog */}
			{deleteTaskId && (
				<DeleteTaskDialog taskId={deleteTaskId} onOpenChange={(open) => !open && setDeleteTaskId(null)} open />
			)}

			{/* Batch delete dialog */}
			{showBatchDeleteDialog && (
				<BatchDeleteTaskDialog
					taskIds={selectedTaskIds}
					open={showBatchDeleteDialog}
					onOpenChange={(open) => {
						if (!open) {
							setShowBatchDeleteDialog(false)
							setSelectedTaskIds([])
							setIsSelectionMode(false)
						}
					}}
				/>
			)}
			{
				// kilocode_change start
				<div className="fixed bottom-0 right-0">
					<BottomControls />
				</div>
				// kilocode_change end
			}
		</Tab>
	)
}

export default memo(HistoryView)
