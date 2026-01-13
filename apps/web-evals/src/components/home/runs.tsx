"use client"

import { useCallback, useEffect, useMemo, useState, memo } from "react"
import { useRouter } from "next/navigation"
import {
	ArrowDown,
	ArrowUp,
	ArrowUpDown,
	Box,
	Boxes,
	Check,
	CheckCircle,
	CircleDot,
	ClipboardList,
	Cog,
	Combine,
	Ellipsis,
	File,
	FileText,
	Folder,
	FolderOpen,
	Hammer,
	Hexagon,
	Layers,
	List,
	ListChecks,
	ListTodo,
	LoaderCircle,
	Package,
	Pencil,
	PencilLine,
	Plus,
	Rocket,
	Search,
	Settings2,
	Shapes,
	Square,
	Star,
	Tag,
	Terminal,
	Trash2,
	Wrench,
	X,
	Zap,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { toast } from "sonner"

import type { Run, TaskMetrics } from "@roo-code/evals"
import type { ToolName } from "@roo-code/types"

import { deleteIncompleteRuns, deleteOldRuns } from "@/actions/runs"
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	Button,
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
	Input,
	MultiSelect,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui"
import { Run as Row } from "@/components/home/run"

// Available icons for tool groups
const TOOL_GROUP_ICONS: { name: string; icon: LucideIcon }[] = [
	{ name: "combine", icon: Combine },
	{ name: "layers", icon: Layers },
	{ name: "box", icon: Box },
	{ name: "boxes", icon: Boxes },
	{ name: "package", icon: Package },
	{ name: "folder", icon: Folder },
	{ name: "folder-open", icon: FolderOpen },
	{ name: "file", icon: File },
	{ name: "file-text", icon: FileText },
	{ name: "list", icon: List },
	{ name: "list-todo", icon: ListTodo },
	{ name: "list-checks", icon: ListChecks },
	{ name: "clipboard-list", icon: ClipboardList },
	{ name: "check", icon: Check },
	{ name: "check-circle", icon: CheckCircle },
	{ name: "pencil", icon: PencilLine },
	{ name: "trash", icon: Trash2 },
	{ name: "x", icon: X },
	{ name: "search", icon: Search },
	{ name: "terminal", icon: Terminal },
	{ name: "shapes", icon: Shapes },
	{ name: "hexagon", icon: Hexagon },
	{ name: "square", icon: Square },
	{ name: "circle-dot", icon: CircleDot },
	{ name: "star", icon: Star },
	{ name: "zap", icon: Zap },
	{ name: "hammer", icon: Hammer },
	{ name: "wrench", icon: Wrench },
	{ name: "cog", icon: Cog },
	{ name: "settings", icon: Settings2 },
	{ name: "tag", icon: Tag },
]

// Tool group type
export type ToolGroup = {
	id: string
	name: string
	icon: string
	tools: string[]
}

// Helper to get icon component by name
function getIconByName(name: string): LucideIcon {
	return TOOL_GROUP_ICONS.find((i) => i.name === name)?.icon ?? Combine
}

// Generate a unique ID for tool groups
function generateGroupId(): string {
	return `group-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
}

// Isolated dialog component to prevent parent re-renders on state changes
const ToolGroupEditorDialog = memo(function ToolGroupEditorDialog({
	open,
	onOpenChange,
	editingGroup,
	availableTools,
	onSave,
}: {
	open: boolean
	onOpenChange: (open: boolean) => void
	editingGroup: ToolGroup | null
	availableTools: { label: string; value: string }[]
	onSave: (group: ToolGroup) => void
}) {
	const [groupName, setGroupName] = useState(editingGroup?.name ?? "")
	const [groupIcon, setGroupIcon] = useState(editingGroup?.icon ?? "combine")
	const [groupTools, setGroupTools] = useState<string[]>(editingGroup?.tools ?? [])

	// Reset form when dialog opens or editingGroup changes
	useEffect(() => {
		if (open) {
			setGroupName(editingGroup?.name ?? "")
			setGroupIcon(editingGroup?.icon ?? "combine")
			setGroupTools(editingGroup?.tools ?? [])
		}
	}, [open, editingGroup])

	const canSaveGroup = groupName.trim().length > 0 && groupTools.length > 0

	const handleSave = () => {
		if (!canSaveGroup) return
		const group: ToolGroup = {
			id: editingGroup?.id ?? generateGroupId(),
			name: groupName.trim(),
			icon: groupIcon,
			tools: groupTools,
		}
		onSave(group)
		onOpenChange(false)
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-md">
				<DialogHeader>
					<DialogTitle>{editingGroup ? "Edit Tool Group" : "Create Tool Group"}</DialogTitle>
				</DialogHeader>
				<div className="space-y-4 py-4">
					<div className="space-y-2">
						<label className="text-sm font-medium">
							Group Name <span className="text-destructive">*</span>
						</label>
						<Input
							placeholder="e.g., File Operations"
							value={groupName}
							onChange={(e) => setGroupName(e.target.value)}
							className={!groupName.trim() ? "border-muted-foreground/30" : ""}
						/>
					</div>
					<div className="space-y-2">
						<label className="text-sm font-medium">Icon</label>
						<div className="flex flex-wrap gap-2">
							{TOOL_GROUP_ICONS.map(({ name, icon: IconComponent }) => (
								<Button
									key={name}
									variant={groupIcon === name ? "default" : "outline"}
									size="icon"
									className="h-8 w-8"
									onClick={() => setGroupIcon(name)}>
									<IconComponent className="h-4 w-4" />
								</Button>
							))}
						</div>
					</div>
					<div className="space-y-2">
						<label className="text-sm font-medium">
							Tools <span className="text-destructive">*</span>
						</label>
						<MultiSelect
							options={availableTools}
							value={groupTools}
							onValueChange={setGroupTools}
							placeholder="Select tools..."
							className="w-full"
							maxCount={3}
							modalPopover
						/>
						<div className="text-xs text-muted-foreground">
							{groupTools.length > 0
								? `${groupTools.length} tool${groupTools.length !== 1 ? "s" : ""} selected`
								: "Select at least one tool"}
						</div>
					</div>
				</div>
				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button onClick={handleSave} disabled={!canSaveGroup}>
						{editingGroup ? "Save Changes" : "Create Group"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
})

type RunWithTaskMetrics = Run & { taskMetrics: TaskMetrics | null }

type SortColumn = "model" | "provider" | "passed" | "failed" | "percent" | "cost" | "duration" | "createdAt"
type SortDirection = "asc" | "desc"

type TimeframeOption = "all" | "24h" | "7d" | "30d" | "90d"

const TIMEFRAME_OPTIONS: { value: TimeframeOption; label: string }[] = [
	{ value: "all", label: "All time" },
	{ value: "24h", label: "Last 24 hours" },
	{ value: "7d", label: "Last 7 days" },
	{ value: "30d", label: "Last 30 days" },
	{ value: "90d", label: "Last 90 days" },
]

// LocalStorage keys
const STORAGE_KEYS = {
	TIMEFRAME: "evals-runs-timeframe",
	MODEL_FILTER: "evals-runs-model-filter",
	PROVIDER_FILTER: "evals-runs-provider-filter",
	TOOL_GROUPS: "evals-runs-tool-groups",
}

function getTimeframeStartDate(timeframe: TimeframeOption): Date | null {
	if (timeframe === "all") return null
	const now = new Date()
	switch (timeframe) {
		case "24h":
			return new Date(now.getTime() - 24 * 60 * 60 * 1000)
		case "7d":
			return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
		case "30d":
			return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
		case "90d":
			return new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
		default:
			return null
	}
}

// Generate abbreviation from tool name (e.g., "read_file" -> "RF", "list_code_definition_names" -> "LCDN")
function getToolAbbreviation(toolName: string): string {
	return toolName
		.split("_")
		.map((word) => word[0]?.toUpperCase() ?? "")
		.join("")
}

function SortIcon({
	column,
	sortColumn,
	sortDirection,
}: {
	column: SortColumn
	sortColumn: SortColumn | null
	sortDirection: SortDirection
}) {
	if (sortColumn !== column) {
		return <ArrowUpDown className="ml-1 h-3 w-3 opacity-50" />
	}
	return sortDirection === "asc" ? <ArrowUp className="ml-1 h-3 w-3" /> : <ArrowDown className="ml-1 h-3 w-3" />
}

export function Runs({ runs }: { runs: RunWithTaskMetrics[] }) {
	const router = useRouter()
	const [sortColumn, setSortColumn] = useState<SortColumn | null>("createdAt")
	const [sortDirection, setSortDirection] = useState<SortDirection>("desc")

	// Filter state - initialize from localStorage
	const [timeframeFilter, setTimeframeFilter] = useState<TimeframeOption>(() => {
		if (typeof window === "undefined") return "all"
		const stored = localStorage.getItem(STORAGE_KEYS.TIMEFRAME)
		return (stored as TimeframeOption) || "all"
	})
	const [modelFilter, setModelFilter] = useState<string[]>(() => {
		if (typeof window === "undefined") return []
		const stored = localStorage.getItem(STORAGE_KEYS.MODEL_FILTER)
		return stored ? JSON.parse(stored) : []
	})
	const [providerFilter, setProviderFilter] = useState<string[]>(() => {
		if (typeof window === "undefined") return []
		const stored = localStorage.getItem(STORAGE_KEYS.PROVIDER_FILTER)
		return stored ? JSON.parse(stored) : []
	})

	// Tool groups state - initialize from localStorage
	const [toolGroups, setToolGroups] = useState<ToolGroup[]>(() => {
		if (typeof window === "undefined") return []
		const stored = localStorage.getItem(STORAGE_KEYS.TOOL_GROUPS)
		if (stored) {
			try {
				return JSON.parse(stored)
			} catch {
				return []
			}
		}
		return []
	})

	// Tool group editor dialog state
	const [showGroupDialog, setShowGroupDialog] = useState(false)
	const [editingGroup, setEditingGroup] = useState<ToolGroup | null>(null)

	// Delete runs state
	const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
	const [showDeleteOldConfirm, setShowDeleteOldConfirm] = useState(false)
	const [isDeleting, setIsDeleting] = useState(false)

	// Persist filters to localStorage
	useEffect(() => {
		localStorage.setItem(STORAGE_KEYS.TIMEFRAME, timeframeFilter)
	}, [timeframeFilter])

	useEffect(() => {
		localStorage.setItem(STORAGE_KEYS.MODEL_FILTER, JSON.stringify(modelFilter))
	}, [modelFilter])

	useEffect(() => {
		localStorage.setItem(STORAGE_KEYS.PROVIDER_FILTER, JSON.stringify(providerFilter))
	}, [providerFilter])

	useEffect(() => {
		localStorage.setItem(STORAGE_KEYS.TOOL_GROUPS, JSON.stringify(toolGroups))
	}, [toolGroups])

	// Count incomplete runs (runs without taskMetricsId)
	const incompleteRunsCount = useMemo(() => {
		return runs.filter((run) => run.taskMetrics === null).length
	}, [runs])

	// Count runs older than 30 days
	const oldRunsCount = useMemo(() => {
		const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
		return runs.filter((run) => run.createdAt < thirtyDaysAgo).length
	}, [runs])

	const handleDeleteIncompleteRuns = useCallback(async () => {
		setIsDeleting(true)
		try {
			const result = await deleteIncompleteRuns()
			if (result.success) {
				toast.success(`Deleted ${result.deletedCount} incomplete run${result.deletedCount !== 1 ? "s" : ""}`)
				if (result.storageErrors.length > 0) {
					toast.warning(`Some storage folders could not be deleted: ${result.storageErrors.length} errors`)
				}
				router.refresh()
			} else {
				toast.error("Failed to delete incomplete runs")
			}
		} catch (error) {
			console.error("Error deleting incomplete runs:", error)
			toast.error("Failed to delete incomplete runs")
		} finally {
			setIsDeleting(false)
			setShowDeleteConfirm(false)
		}
	}, [router])

	const handleDeleteOldRuns = useCallback(async () => {
		setIsDeleting(true)
		try {
			const result = await deleteOldRuns()
			if (result.success) {
				toast.success(
					`Deleted ${result.deletedCount} run${result.deletedCount !== 1 ? "s" : ""} older than 30 days`,
				)
				if (result.storageErrors.length > 0) {
					toast.warning(`Some storage folders could not be deleted: ${result.storageErrors.length} errors`)
				}
				router.refresh()
			} else {
				toast.error("Failed to delete old runs")
			}
		} catch (error) {
			console.error("Error deleting old runs:", error)
			toast.error("Failed to delete old runs")
		} finally {
			setIsDeleting(false)
			setShowDeleteOldConfirm(false)
		}
	}, [router])

	const handleSort = (column: SortColumn) => {
		if (sortColumn === column) {
			setSortDirection(sortDirection === "asc" ? "desc" : "asc")
		} else {
			setSortColumn(column)
			setSortDirection("desc")
		}
	}

	// Derive unique models and providers from runs
	const modelOptions = useMemo(() => {
		const models = new Set<string>()
		for (const run of runs) {
			if (run.model) models.add(run.model)
		}
		return Array.from(models)
			.sort()
			.map((model) => ({ label: model, value: model }))
	}, [runs])

	const providerOptions = useMemo(() => {
		const providers = new Set<string>()
		for (const run of runs) {
			const provider = run.settings?.apiProvider
			if (provider) providers.add(provider)
		}
		return Array.from(providers)
			.sort()
			.map((provider) => ({ label: provider, value: provider }))
	}, [runs])

	// Filter runs based on filter state
	const filteredRuns = useMemo(() => {
		return runs.filter((run) => {
			// Timeframe filter
			const timeframeStart = getTimeframeStartDate(timeframeFilter)
			if (timeframeStart && run.createdAt < timeframeStart) {
				return false
			}

			// Model filter
			if (modelFilter.length > 0 && !modelFilter.includes(run.model)) {
				return false
			}

			// Provider filter
			if (providerFilter.length > 0) {
				const provider = run.settings?.apiProvider
				if (!provider || !providerFilter.includes(provider)) {
					return false
				}
			}

			return true
		})
	}, [runs, timeframeFilter, modelFilter, providerFilter])

	// Collect all unique tool names from filtered runs and sort by total attempts
	const allToolColumns = useMemo<ToolName[]>(() => {
		const toolTotals = new Map<ToolName, number>()

		for (const run of filteredRuns) {
			if (run.taskMetrics?.toolUsage) {
				for (const [toolName, usage] of Object.entries(run.taskMetrics.toolUsage)) {
					const tool = toolName as ToolName
					const current = toolTotals.get(tool) ?? 0
					toolTotals.set(tool, current + usage.attempts)
				}
			}
		}

		// Sort by total attempts descending
		return Array.from(toolTotals.entries())
			.sort((a, b) => b[1] - a[1])
			.map(([name]): ToolName => name)
	}, [filteredRuns])

	// Tool column options for the group editor
	const toolColumnOptions = useMemo(() => {
		return allToolColumns.map((tool) => ({
			label: tool,
			value: tool,
		}))
	}, [allToolColumns])

	// Get all tools that are in any group
	const groupedTools = useMemo(() => {
		const grouped = new Set<string>()
		for (const group of toolGroups) {
			for (const tool of group.tools) {
				grouped.add(tool)
			}
		}
		return grouped
	}, [toolGroups])

	// Separate grouped and individual tool columns
	const individualToolColumns = useMemo(() => {
		return allToolColumns.filter((tool) => !groupedTools.has(tool))
	}, [allToolColumns, groupedTools])

	// Use individualToolColumns for rendering
	const toolColumns = individualToolColumns

	// Sort filtered runs based on current sort column and direction
	const sortedRuns = useMemo(() => {
		if (!sortColumn) return filteredRuns

		return [...filteredRuns].sort((a, b) => {
			let aVal: string | number | Date | null = null
			let bVal: string | number | Date | null = null

			switch (sortColumn) {
				case "model":
					aVal = a.model
					bVal = b.model
					break
				case "provider":
					aVal = a.settings?.apiProvider ?? ""
					bVal = b.settings?.apiProvider ?? ""
					break
				case "passed":
					aVal = a.passed
					bVal = b.passed
					break
				case "failed":
					aVal = a.failed
					bVal = b.failed
					break
				case "percent":
					aVal = a.passed + a.failed > 0 ? a.passed / (a.passed + a.failed) : 0
					bVal = b.passed + b.failed > 0 ? b.passed / (b.passed + b.failed) : 0
					break
				case "cost":
					aVal = a.taskMetrics?.cost ?? 0
					bVal = b.taskMetrics?.cost ?? 0
					break
				case "duration":
					aVal = a.taskMetrics?.duration ?? 0
					bVal = b.taskMetrics?.duration ?? 0
					break
				case "createdAt":
					aVal = a.createdAt
					bVal = b.createdAt
					break
			}

			if (aVal === null || bVal === null) return 0

			let comparison = 0
			if (typeof aVal === "string" && typeof bVal === "string") {
				comparison = aVal.localeCompare(bVal)
			} else if (aVal instanceof Date && bVal instanceof Date) {
				comparison = aVal.getTime() - bVal.getTime()
			} else {
				comparison = (aVal as number) - (bVal as number)
			}

			return sortDirection === "asc" ? comparison : -comparison
		})
	}, [filteredRuns, sortColumn, sortDirection])

	// Calculate colSpan for empty state (7 base columns + tool groups + dynamic tools + 3 end columns)
	const totalColumns = 7 + toolGroups.length + toolColumns.length + 3

	// Check if any filters are active
	const hasActiveFilters = timeframeFilter !== "all" || modelFilter.length > 0 || providerFilter.length > 0

	const clearAllFilters = () => {
		setTimeframeFilter("all")
		setModelFilter([])
		setProviderFilter([])
	}

	// Tool group management handlers
	const openNewGroupDialog = useCallback(() => {
		setEditingGroup(null)
		setShowGroupDialog(true)
	}, [])

	const openEditGroupDialog = useCallback((group: ToolGroup) => {
		setEditingGroup(group)
		setShowGroupDialog(true)
	}, [])

	const handleSaveGroup = useCallback(
		(group: ToolGroup) => {
			setToolGroups((prev) => {
				const existingIndex = prev.findIndex((g) => g.id === group.id)
				if (existingIndex >= 0) {
					// Update existing group
					const newGroups = [...prev]
					newGroups[existingIndex] = group
					return newGroups
				} else {
					// Add new group
					return [...prev, group]
				}
			})
			toast.success(editingGroup ? "Group updated" : "Group created")
		},
		[editingGroup],
	)

	const handleDeleteGroup = useCallback((groupId: string) => {
		setToolGroups((prev) => prev.filter((g) => g.id !== groupId))
		toast.success("Group deleted")
	}, [])

	// Get available tools for group editor (tools not in other groups)
	const availableToolsForEditor = useMemo(() => {
		const usedInOtherGroups = new Set<string>()
		for (const group of toolGroups) {
			if (editingGroup && group.id === editingGroup.id) continue
			for (const tool of group.tools) {
				usedInOtherGroups.add(tool)
			}
		}
		return toolColumnOptions.filter((opt) => !usedInOtherGroups.has(opt.value))
	}, [toolColumnOptions, toolGroups, editingGroup])

	return (
		<>
			{/* Filter Controls */}
			<div className="flex items-center gap-4 p-4 border border-b-0 rounded-t-md bg-muted/30">
				<div className="flex items-center gap-2">
					<span className="text-sm font-medium text-muted-foreground">Timeframe:</span>
					<Select
						value={timeframeFilter}
						onValueChange={(value) => setTimeframeFilter(value as TimeframeOption)}>
						<SelectTrigger className="w-[140px]">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{TIMEFRAME_OPTIONS.map((option) => (
								<SelectItem key={option.value} value={option.value}>
									{option.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>

				<div className="flex items-center gap-2">
					<span className="text-sm font-medium text-muted-foreground">Model:</span>
					<MultiSelect
						options={modelOptions}
						value={modelFilter}
						onValueChange={setModelFilter}
						placeholder="All models"
						className="w-[200px]"
						maxCount={1}
					/>
				</div>

				<div className="flex items-center gap-2">
					<span className="text-sm font-medium text-muted-foreground">Provider:</span>
					<MultiSelect
						options={providerOptions}
						value={providerFilter}
						onValueChange={setProviderFilter}
						placeholder="All providers"
						className="w-[180px]"
						maxCount={1}
					/>
				</div>

				{/* Tool Groups Dropdown */}
				<div className="flex items-center gap-2">
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button variant="outline" size="sm" className="flex items-center gap-2">
								<Layers className="h-4 w-4" />
								<span>Groups</span>
								{toolGroups.length > 0 && (
									<span className="bg-primary text-primary-foreground text-xs px-1.5 rounded-full">
										{toolGroups.length}
									</span>
								)}
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="start" className="w-64">
							{toolGroups.length > 0 ? (
								<>
									{toolGroups.map((group) => {
										const IconComponent = getIconByName(group.icon)
										return (
											<DropdownMenuItem
												key={group.id}
												className="flex items-center justify-between"
												onClick={(e) => {
													e.preventDefault()
													openEditGroupDialog(group)
												}}>
												<div className="flex items-center gap-2">
													<IconComponent className="h-4 w-4" />
													<span>{group.name}</span>
													<span className="text-xs text-muted-foreground">
														({group.tools.length})
													</span>
												</div>
												<div className="flex items-center gap-1">
													<Button
														variant="ghost"
														size="icon"
														className="h-6 w-6"
														onClick={(e) => {
															e.stopPropagation()
															openEditGroupDialog(group)
														}}>
														<Pencil className="h-3 w-3" />
													</Button>
													<Button
														variant="ghost"
														size="icon"
														className="h-6 w-6 text-destructive hover:text-destructive"
														onClick={(e) => {
															e.stopPropagation()
															handleDeleteGroup(group.id)
														}}>
														<Trash2 className="h-3 w-3" />
													</Button>
												</div>
											</DropdownMenuItem>
										)
									})}
									<DropdownMenuSeparator />
								</>
							) : (
								<div className="px-2 py-1.5 text-sm text-muted-foreground">No groups yet</div>
							)}
							<DropdownMenuItem onClick={openNewGroupDialog}>
								<Plus className="h-4 w-4 mr-2" />
								Add Group
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				</div>

				{hasActiveFilters && (
					<Button variant="ghost" size="sm" onClick={clearAllFilters}>
						<X className="h-4 w-4 mr-1" />
						Clear filters
					</Button>
				)}

				<div className="flex items-center gap-2 ml-auto">
					{/* Bulk Actions Menu */}
					{(incompleteRunsCount > 0 || oldRunsCount > 0) && (
						<DropdownMenu>
							<Button variant="ghost" size="sm" asChild>
								<DropdownMenuTrigger disabled={isDeleting}>
									<Ellipsis className="h-4 w-4" />
								</DropdownMenuTrigger>
							</Button>
							<DropdownMenuContent align="end">
								{incompleteRunsCount > 0 && (
									<DropdownMenuItem
										onClick={() => setShowDeleteConfirm(true)}
										disabled={isDeleting}
										className="text-destructive focus:text-destructive">
										<Trash2 className="h-4 w-4 mr-2" />
										Delete {incompleteRunsCount} incomplete run
										{incompleteRunsCount !== 1 ? "s" : ""}
									</DropdownMenuItem>
								)}
								{oldRunsCount > 0 && (
									<DropdownMenuItem
										onClick={() => setShowDeleteOldConfirm(true)}
										disabled={isDeleting}
										className="text-destructive focus:text-destructive">
										<Trash2 className="h-4 w-4 mr-2" />
										Delete {oldRunsCount} run{oldRunsCount !== 1 ? "s" : ""} over 30d
									</DropdownMenuItem>
								)}
							</DropdownMenuContent>
						</DropdownMenu>
					)}
					<div className="text-sm text-muted-foreground">
						{filteredRuns.length} of {runs.length} runs
					</div>
				</div>
			</div>

			<Table className="border border-t-0 rounded-t-none">
				<TableHeader>
					<TableRow>
						<TableHead
							className="max-w-[200px] cursor-pointer select-none"
							onClick={() => handleSort("model")}>
							<div className="flex items-center">
								Model
								<SortIcon column="model" sortColumn={sortColumn} sortDirection={sortDirection} />
							</div>
						</TableHead>
						<TableHead className="cursor-pointer select-none" onClick={() => handleSort("provider")}>
							<div className="flex items-center">
								Provider
								<SortIcon column="provider" sortColumn={sortColumn} sortDirection={sortDirection} />
							</div>
						</TableHead>
						<TableHead className="cursor-pointer select-none" onClick={() => handleSort("createdAt")}>
							<div className="flex items-center">
								Created
								<SortIcon column="createdAt" sortColumn={sortColumn} sortDirection={sortDirection} />
							</div>
						</TableHead>
						<TableHead className="cursor-pointer select-none" onClick={() => handleSort("passed")}>
							<div className="flex items-center">
								Passed
								<SortIcon column="passed" sortColumn={sortColumn} sortDirection={sortDirection} />
							</div>
						</TableHead>
						<TableHead className="cursor-pointer select-none" onClick={() => handleSort("failed")}>
							<div className="flex items-center">
								Failed
								<SortIcon column="failed" sortColumn={sortColumn} sortDirection={sortDirection} />
							</div>
						</TableHead>
						<TableHead className="cursor-pointer select-none" onClick={() => handleSort("percent")}>
							<div className="flex items-center">
								%
								<SortIcon column="percent" sortColumn={sortColumn} sortDirection={sortDirection} />
							</div>
						</TableHead>
						<TableHead>Tokens</TableHead>
						{/* Tool Group Columns */}
						{toolGroups.map((group) => {
							const IconComponent = getIconByName(group.icon)
							return (
								<TableHead key={group.id} className="text-center">
									<div className="flex justify-center">
										<Tooltip>
											<TooltipTrigger>
												<IconComponent className="h-4 w-4" />
											</TooltipTrigger>
											<TooltipContent>
												<div className="text-xs">
													<div className="font-semibold mb-1">{group.name}</div>
													{group.tools.map((tool) => (
														<div key={tool}>{tool}</div>
													))}
												</div>
											</TooltipContent>
										</Tooltip>
									</div>
								</TableHead>
							)
						})}
						{/* Individual Tool Columns */}
						{toolColumns.map((toolName) => (
							<TableHead key={toolName} className="text-xs text-center">
								<Tooltip>
									<TooltipTrigger>{getToolAbbreviation(toolName)}</TooltipTrigger>
									<TooltipContent>{toolName}</TooltipContent>
								</Tooltip>
							</TableHead>
						))}
						<TableHead className="cursor-pointer select-none" onClick={() => handleSort("cost")}>
							<div className="flex items-center">
								Cost
								<SortIcon column="cost" sortColumn={sortColumn} sortDirection={sortDirection} />
							</div>
						</TableHead>
						<TableHead className="cursor-pointer select-none" onClick={() => handleSort("duration")}>
							<div className="flex items-center">
								Duration
								<SortIcon column="duration" sortColumn={sortColumn} sortDirection={sortDirection} />
							</div>
						</TableHead>
						<TableHead></TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{sortedRuns.length ? (
						sortedRuns.map(({ taskMetrics, ...run }) => (
							<Row
								key={run.id}
								run={run}
								taskMetrics={taskMetrics}
								toolColumns={toolColumns}
								toolGroups={toolGroups}
							/>
						))
					) : (
						<TableRow>
							<TableCell colSpan={totalColumns} className="text-center py-8">
								{runs.length === 0 ? (
									<>
										No eval runs yet.
										<Button variant="link" onClick={() => router.push("/runs/new")}>
											Launch
										</Button>
										one now.
									</>
								) : (
									<>
										No runs match the current filters.
										<Button variant="link" onClick={clearAllFilters}>
											Clear filters
										</Button>
										to see all runs.
									</>
								)}
							</TableCell>
						</TableRow>
					)}
				</TableBody>
			</Table>
			<Button
				variant="default"
				className="absolute top-4 right-12 size-12 rounded-full"
				onClick={() => router.push("/runs/new")}>
				<Rocket className="size-6" />
			</Button>

			{/* Tool Group Editor Dialog */}
			<ToolGroupEditorDialog
				open={showGroupDialog}
				onOpenChange={setShowGroupDialog}
				editingGroup={editingGroup}
				availableTools={availableToolsForEditor}
				onSave={handleSaveGroup}
			/>

			{/* Delete Incomplete Runs Confirmation Dialog */}
			<AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete Incomplete Runs</AlertDialogTitle>
						<AlertDialogDescription>
							Are you sure you want to delete {incompleteRunsCount} incomplete run
							{incompleteRunsCount !== 1 ? "s" : ""}? This will permanently remove all database records
							and storage folders for these runs. This action cannot be undone.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={handleDeleteIncompleteRuns}
							disabled={isDeleting}
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
							{isDeleting ? (
								<>
									<LoaderCircle className="h-4 w-4 mr-2 animate-spin" />
									Deleting...
								</>
							) : (
								<>
									Delete {incompleteRunsCount} run{incompleteRunsCount !== 1 ? "s" : ""}
								</>
							)}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			{/* Delete Old Runs Confirmation Dialog */}
			<AlertDialog open={showDeleteOldConfirm} onOpenChange={setShowDeleteOldConfirm}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete Old Runs</AlertDialogTitle>
						<AlertDialogDescription>
							Are you sure you want to delete {oldRunsCount} run{oldRunsCount !== 1 ? "s" : ""} older than
							30 days? This will permanently remove all database records and storage folders for these
							runs. This action cannot be undone.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={handleDeleteOldRuns}
							disabled={isDeleting}
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
							{isDeleting ? (
								<>
									<LoaderCircle className="h-4 w-4 mr-2 animate-spin" />
									Deleting...
								</>
							) : (
								<>
									Delete {oldRunsCount} run{oldRunsCount !== 1 ? "s" : ""}
								</>
							)}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	)
}
