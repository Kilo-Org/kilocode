import React, { useState, useCallback, useMemo } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Button } from "./button"
import { Badge } from "./badge"
import { Separator } from "./separator"
import { Check, X, GitBranch, FileText, ChevronDown, ChevronUp, Plus, Minus } from "lucide-react"
import { cn } from "@/lib/utils"

export interface DiffLine {
	lineNumber: number
	type: "added" | "removed" | "unchanged"
	content: string
	oldLineNumber?: number
	newLineNumber?: number
}

export interface DiffHunk {
	oldStart: number
	oldLines: number
	newStart: number
	newLines: number
	lines: DiffLine[]
}

export interface FileChange {
	filePath: string
	type: "modified" | "added" | "deleted"
	oldContent?: string
	newContent?: string
	hunks?: DiffHunk[]
	status: "pending" | "accepted" | "rejected"
}

export interface SideBySideDiffProps {
	changes: FileChange[]
	onAcceptFile?: (filePath: string) => void
	onRejectFile?: (filePath: string) => void
	onAcceptHunk?: (filePath: string, hunkIndex: number) => void
	onRejectHunk?: (filePath: string, hunkIndex: number) => void
	onPartialAccept?: (filePath: string, lines: number[]) => void
	className?: string
}

export const SideBySideDiff: React.FC<SideBySideDiffProps> = ({
	changes,
	onAcceptFile,
	onRejectFile,
	onAcceptHunk,
	onRejectHunk,
	onPartialAccept,
	className,
}) => {
	const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set())
	const [selectedLines, setSelectedLines] = useState<Record<string, Set<number>>>({})

	const toggleFileExpansion = useCallback((filePath: string) => {
		setExpandedFiles((prev) => {
			const next = new Set(prev)
			if (next.has(filePath)) {
				next.delete(filePath)
			} else {
				next.add(filePath)
			}
			return next
		})
	}, [])

	const toggleLineSelection = useCallback((filePath: string, lineNumber: number) => {
		setSelectedLines((prev) => {
			const next = { ...prev }
			if (!next[filePath]) {
				next[filePath] = new Set()
			}
			const fileLines = next[filePath]!
			if (fileLines.has(lineNumber)) {
				fileLines.delete(lineNumber)
			} else {
				fileLines.add(lineNumber)
			}
			return next
		})
	}, [])

	const handlePartialAccept = useCallback(
		(filePath: string) => {
			const selectedLinesSet = selectedLines[filePath]
			if (selectedLinesSet && selectedLinesSet.size > 0 && onPartialAccept) {
				onPartialAccept(filePath, Array.from(selectedLinesSet))
				setSelectedLines((prev) => {
					const next = { ...prev }
					delete next[filePath]
					return next
				})
			}
		},
		[selectedLines, onPartialAccept],
	)

	const stats = useMemo(() => {
		let totalAdded = 0
		let totalDeleted = 0
		let totalModified = 0

		changes.forEach((change) => {
			if (change.type === "added") totalAdded++
			else if (change.type === "deleted") totalDeleted++
			else if (change.type === "modified") totalModified++
		})

		return { totalAdded, totalDeleted, totalModified }
	}, [changes])

	return (
		<motion.div
			initial={{ opacity: 0, y: 20 }}
			animate={{ opacity: 1, y: 0 }}
			className={cn("border border-vscode-border rounded-lg bg-vscode-editor-background", className)}>
			{/* Header */}
			<div className="flex items-center justify-between p-4 border-b border-vscode-border">
				<div className="flex items-center gap-4">
					<h3 className="text-lg font-semibold text-vscode-foreground">Review Changes</h3>
					<div className="flex gap-2">
						<Badge variant="secondary" className="text-green-500">
							+{stats.totalAdded}
						</Badge>
						<Badge variant="secondary" className="text-red-500">
							-{stats.totalDeleted}
						</Badge>
						<Badge variant="secondary" className="text-yellow-500">
							~{stats.totalModified}
						</Badge>
					</div>
				</div>
				<div className="flex gap-2">
					<Button
						size="sm"
						variant="outline"
						onClick={() => {
							changes.forEach((change) => {
								if (change.status === "pending" && onAcceptFile) {
									onAcceptFile(change.filePath)
								}
							})
						}}>
						<Check className="w-4 h-4 mr-1" />
						Accept All
					</Button>
					<Button
						size="sm"
						variant="outline"
						onClick={() => {
							changes.forEach((change) => {
								if (change.status === "pending" && onRejectFile) {
									onRejectFile(change.filePath)
								}
							})
						}}>
						<X className="w-4 h-4 mr-1" />
						Reject All
					</Button>
				</div>
			</div>

			{/* File List */}
			<div className="divide-y divide-vscode-border">
				<AnimatePresence>
					{changes.map((change, index) => (
						<motion.div
							key={change.filePath}
							initial={{ opacity: 0, height: 0 }}
							animate={{ opacity: 1, height: "auto" }}
							exit={{ opacity: 0, height: 0 }}
							transition={{ duration: 0.2, delay: index * 0.05 }}>
							{/* File Header */}
							<div
								className={cn(
									"flex items-center justify-between p-4 cursor-pointer hover:bg-vscode-toolbar-background transition-colors",
									change.status === "accepted" && "bg-green-500/10",
									change.status === "rejected" && "bg-red-500/10",
								)}
								onClick={() => toggleFileExpansion(change.filePath)}>
								<div className="flex items-center gap-3">
									{expandedFiles.has(change.filePath) ? (
										<ChevronDown className="w-4 h-4 text-vscode-foreground" />
									) : (
										<ChevronUp className="w-4 h-4 text-vscode-foreground" />
									)}
									<FileText className="w-4 h-4 text-vscode-foreground" />
									<span className="text-sm font-medium text-vscode-foreground">
										{change.filePath}
									</span>
									<Badge
										variant={
											change.type === "added"
												? "default"
												: change.type === "deleted"
													? "destructive"
													: "secondary"
										}
										className="text-xs">
										{change.type}
									</Badge>
									{change.status !== "pending" && (
										<Badge variant="outline" className="text-xs">
											{change.status}
										</Badge>
									)}
								</div>

								<div className="flex items-center gap-2">
									{change.status === "pending" && (
										<>
											<Button
												size="sm"
												variant="ghost"
												onClick={(e) => {
													e.stopPropagation()
													if (onAcceptFile) onAcceptFile(change.filePath)
												}}>
												<Check className="w-4 h-4" />
											</Button>
											<Button
												size="sm"
												variant="ghost"
												onClick={(e) => {
													e.stopPropagation()
													if (onRejectFile) onRejectFile(change.filePath)
												}}>
												<X className="w-4 h-4" />
											</Button>
										</>
									)}
								</div>
							</div>

							{/* Diff Content */}
							<AnimatePresence>
								{expandedFiles.has(change.filePath) && (
									<motion.div
										initial={{ height: 0, opacity: 0 }}
										animate={{ height: "auto", opacity: 1 }}
										exit={{ height: 0, opacity: 0 }}
										transition={{ duration: 0.2 }}
										className="overflow-hidden">
										<div className="border-t border-vscode-border">
											{/* Partial Accept Controls */}
											{selectedLines[change.filePath] &&
												selectedLines[change.filePath]!.size > 0 && (
													<div className="flex items-center justify-between p-2 bg-vscode-toolbar-background border-b border-vscode-border">
														<span className="text-sm text-vscode-foreground">
															{selectedLines[change.filePath]!.size} lines selected
														</span>
														<Button
															size="sm"
															onClick={() => handlePartialAccept(change.filePath)}>
															Accept Selected
														</Button>
													</div>
												)}

											{/* Custom Diff View */}
											<div className="overflow-x-auto font-mono text-sm">
												{change.hunks?.map((hunk, hunkIndex) => (
													<div key={hunkIndex} className="border-b border-vscode-border/50">
														{/* Hunk Header */}
														<div className="flex items-center justify-between p-2 bg-vscode-toolbar-background/50">
															<span className="text-xs text-vscode-descriptionForeground">
																@@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},
																{hunk.newLines} @@
															</span>
															{change.status === "pending" && (
																<div className="flex gap-1">
																	<Button
																		size="sm"
																		variant="ghost"
																		onClick={() => {
																			if (onAcceptHunk)
																				onAcceptHunk(change.filePath, hunkIndex)
																		}}>
																		<Check className="w-3 h-3" />
																	</Button>
																	<Button
																		size="sm"
																		variant="ghost"
																		onClick={() => {
																			if (onRejectHunk)
																				onRejectHunk(change.filePath, hunkIndex)
																		}}>
																		<X className="w-3 h-3" />
																	</Button>
																</div>
															)}
														</div>

														{/* Diff Lines */}
														<div className="divide-y divide-vscode-border/30">
															{hunk.lines.map((line, lineIndex) => (
																<div
																	key={lineIndex}
																	className={cn(
																		"flex items-center gap-4 px-4 py-1 cursor-pointer group hover:bg-vscode-toolbar-background/30",
																		line.type === "added" && "bg-green-500/10",
																		line.type === "removed" && "bg-red-500/10",
																		selectedLines[change.filePath]?.has(
																			line.lineNumber,
																		) && "bg-blue-500/20",
																	)}
																	onClick={() =>
																		toggleLineSelection(
																			change.filePath,
																			line.lineNumber,
																		)
																	}>
																	{/* Line Numbers */}
																	<div className="flex gap-4 text-xs text-vscode-descriptionForeground min-w-[80px]">
																		<span className="w-8 text-right">
																			{line.oldLineNumber ?? ""}
																		</span>
																		<span className="w-8 text-right">
																			{line.newLineNumber ?? ""}
																		</span>
																	</div>

																	{/* Line Type Indicator */}
																	<div className="w-4">
																		{line.type === "added" && (
																			<Plus className="w-3 h-3 text-green-500" />
																		)}
																		{line.type === "removed" && (
																			<Minus className="w-3 h-3 text-red-500" />
																		)}
																		{line.type === "unchanged" && (
																			<span className="w-3 h-3 block" />
																		)}
																	</div>

																	{/* Line Content */}
																	<div
																		className={cn(
																			"flex-1 whitespace-pre",
																			line.type === "added" && "text-green-500",
																			line.type === "removed" && "text-red-500",
																		)}>
																		{line.content}
																	</div>
																</div>
															))}
														</div>
													</div>
												))}
											</div>
										</div>
									</motion.div>
								)}
							</AnimatePresence>
						</motion.div>
					))}
				</AnimatePresence>
			</div>

			{changes.length === 0 && (
				<div className="p-8 text-center text-vscode-descriptionForeground">
					<GitBranch className="w-12 h-12 mx-auto mb-4 opacity-50" />
					<p>No changes to review</p>
				</div>
			)}
		</motion.div>
	)
}
