/**
 * Citation Component
 * Displays clickable source citations in AI responses
 */

import React, { useState } from "react"
import { FileText, ExternalLink, BookOpen, ChevronDown, ChevronRight } from "lucide-react"

export interface CitationProps {
	id: string
	sourceType: "file" | "documentation" | "url"
	sourcePath: string
	startLine?: number
	endLine?: number
	snippet: string
	confidence: number
	onClick?: () => void
	onExpand?: () => void
}

export function Citation({
	sourceType,
	sourcePath,
	startLine,
	endLine,
	snippet,
	confidence,
	onClick,
	onExpand,
}: CitationProps) {
	const [isExpanded, setIsExpanded] = useState(false)
	const confidencePercent = Math.round(confidence * 100)

	const getSourceIcon = () => {
		switch (sourceType) {
			case "file":
				return <FileText className="w-4 h-4" />
			case "url":
				return <ExternalLink className="w-4 h-4" />
			case "documentation":
				return <BookOpen className="w-4 h-4" />
		}
	}

	const getSourceLabel = () => {
		switch (sourceType) {
			case "file":
				return "File"
			case "url":
				return "Link"
			case "documentation":
				return "Docs"
		}
	}

	const getConfidenceColor = () => {
		if (confidence >= 0.8) return "text-[var(--vscode-testing-iconPassedForeground)]"
		if (confidence >= 0.6) return "text-[var(--vscode-testing-iconQueuedForeground)]"
		return "text-[var(--vscode-testing-iconFailedForeground)]"
	}

	const getConfidenceLabel = () => {
		if (confidence >= 0.8) return "High"
		if (confidence >= 0.6) return "Medium"
		return "Low"
	}

	const getFileName = () => {
		if (sourceType === "file") {
			const parts = sourcePath.split("/")
			return parts[parts.length - 1]
		}
		return sourcePath
	}

	const getLineNumber = () => {
		if (sourceType === "file" && startLine) {
			if (endLine && endLine !== startLine) {
				return `:${startLine}-${endLine}`
			}
			return `:${startLine}`
		}
		return ""
	}

	const handleExpand = (e: React.MouseEvent) => {
		e.stopPropagation()
		setIsExpanded(!isExpanded)
		onExpand?.()
	}

	const handleClick = () => {
		onClick?.()
	}

	return (
		<div
			className="group flex flex-col gap-2 p-3 rounded-lg border border-vscode-widget-border hover:border-vscode-focusBorder bg-vscode-widget-background hover:bg-vscode-widget-secondaryBackground cursor-pointer transition-all duration-200"
			onClick={handleClick}>
			{/* Citation Header */}
			<div className="flex items-center justify-between gap-2">
				<div className="flex items-center gap-2 flex-1 min-w-0">
					{/* Source Icon */}
					<div className="flex-shrink-0 text-vscode-foreground">{getSourceIcon()}</div>

					{/* Source Info */}
					<div className="flex items-center gap-2 min-w-0 flex-1">
						<span className="text-xs font-medium text-vscode-foreground">{getSourceLabel()}</span>
						<span className="text-xs text-vscode-descriptionForeground truncate">
							{getFileName()}
							{getLineNumber()}
						</span>
					</div>

					{/* Confidence Badge */}
					<div
						className={`flex-shrink-0 flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${getConfidenceColor()}`}>
						<span>{getConfidenceLabel()}</span>
						<span>{confidencePercent}%</span>
					</div>
				</div>

				{/* Expand Button */}
				<button
					className="flex-shrink-0 p-1 rounded hover:bg-vscode-toolbar-hoverBackground transition-colors"
					onClick={handleExpand}
					aria-label={isExpanded ? "Collapse" : "Expand"}>
					{isExpanded ? (
						<ChevronDown className="w-4 h-4 text-vscode-foreground" />
					) : (
						<ChevronRight className="w-4 h-4 text-vscode-foreground" />
					)}
				</button>
			</div>

			{/* Expanded Content */}
			{isExpanded && (
				<div className="mt-2 pt-2 border-t border-vscode-widget-border">
					{/* Full Path */}
					<div className="text-xs text-vscode-descriptionForeground mb-2 break-all">{sourcePath}</div>

					{/* Code Snippet */}
					{snippet && (
						<div className="relative">
							<pre className="p-3 rounded bg-vscode-editor-background border border-vscode-widget-border text-xs text-vscode-editor-foreground overflow-x-auto">
								<code>{snippet}</code>
							</pre>
						</div>
					)}

					{/* Line Numbers */}
					{sourceType === "file" && startLine && (
						<div className="mt-2 text-xs text-vscode-descriptionForeground">
							Lines {startLine}
							{endLine && endLine !== startLine && ` - ${endLine}`}
						</div>
					)}
				</div>
			)}
		</div>
	)
}

export interface CitationListProps {
	citations: CitationProps[]
	onCitationClick?: (citation: CitationProps) => void
}

export function CitationList({ citations, onCitationClick }: CitationListProps) {
	if (citations.length === 0) {
		return null
	}

	return (
		<div className="flex flex-col gap-2">
			<div className="flex items-center gap-2 text-sm font-medium text-vscode-foreground">
				<FileText className="w-4 h-4" />
				<span>Sources ({citations.length})</span>
			</div>
			<div className="flex flex-col gap-2">
				{citations.map((citation) => (
					<Citation key={citation.id} {...citation} onClick={() => onCitationClick?.(citation)} />
				))}
			</div>
		</div>
	)
}

export interface CitationInlineProps {
	citation: CitationProps
	onClick?: () => void
}

export function CitationInline({ citation, onClick }: CitationInlineProps) {
	const confidencePercent = Math.round(citation.confidence * 100)

	return (
		<button
			className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-vscode-button-secondaryBackground hover:bg-vscode-button-secondaryHoverBackground text-xs text-vscode-button-secondaryForeground transition-colors cursor-pointer"
			onClick={onClick}>
			<FileText className="w-3 h-3" />
			<span className="truncate max-w-[200px]">
				{citation.sourcePath.split("/").pop()}
				{citation.startLine && `:${citation.startLine}`}
			</span>
			<span className="text-vscode-descriptionForeground">{confidencePercent}%</span>
		</button>
	)
}
