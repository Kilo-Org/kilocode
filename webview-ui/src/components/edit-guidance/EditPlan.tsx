/**
 * EditPlan Component
 * Displays edit plan with steps and execution controls
 */

import React, { useState } from "react"
import {
	CheckCircle2,
	Circle,
	XCircle,
	AlertTriangle,
	ChevronDown,
	ChevronRight,
	Play,
	SkipForward,
	X,
	Files,
	Clock,
} from "lucide-react"

export interface EditStepProps {
	id: string
	order: number
	title: string
	type: "create" | "update" | "delete" | "move"
	description: string
	status: "pending" | "completed" | "skipped" | "failed"
	files: Array<{
		filePath: string
		changeType: "create" | "update" | "delete"
	}>
	dependencies: string[]
}

export interface EditPlanProps {
	id: string
	title: string
	description: string
	status: "pending" | "in-progress" | "completed" | "cancelled"
	steps: EditStepProps[]
	createdAt: Date
	updatedAt: Date
	onExecuteStep?: (stepId: string) => void
	onExecuteAll?: () => void
	onCancel?: () => void
	onStepClick?: (stepId: string) => void
}

export function EditPlan({
	title,
	description,
	status,
	steps,
	createdAt,
	updatedAt,
	onExecuteStep,
	onExecuteAll,
	onCancel,
	onStepClick,
}: EditPlanProps) {
	const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set())

	const toggleStep = (stepId: string) => {
		const newExpanded = new Set(expandedSteps)
		if (newExpanded.has(stepId)) {
			newExpanded.delete(stepId)
		} else {
			newExpanded.add(stepId)
		}
		setExpandedSteps(newExpanded)
	}

	const getStatusIcon = () => {
		switch (status) {
			case "completed":
				return <CheckCircle2 className="w-5 h-5 text-[var(--vscode-testing-iconPassedForeground)]" />
			case "in-progress":
				return <Clock className="w-5 h-5 text-[var(--vscode-testing-iconQueuedForeground)]" />
			case "cancelled":
				return <XCircle className="w-5 h-5 text-[var(--vscode-testing-iconFailedForeground)]" />
			default:
				return <Circle className="w-5 h-5 text-[var(--vscode-descriptionForeground)]" />
		}
	}

	const getStatusColor = () => {
		switch (status) {
			case "completed":
				return "text-[var(--vscode-testing-iconPassedForeground)]"
			case "in-progress":
				return "text-[var(--vscode-testing-iconQueuedForeground)]"
			case "cancelled":
				return "text-[var(--vscode-testing-iconFailedForeground)]"
			default:
				return "text-[var(--vscode-descriptionForeground)]"
		}
	}

	const getStepStatusIcon = (stepStatus: EditStepProps["status"]) => {
		switch (stepStatus) {
			case "completed":
				return <CheckCircle2 className="w-4 h-4 text-[var(--vscode-testing-iconPassedForeground)]" />
			case "failed":
				return <XCircle className="w-4 h-4 text-[var(--vscode-testing-iconFailedForeground)]" />
			case "skipped":
				return <SkipForward className="w-4 h-4 text-[var(--vscode-descriptionForeground)]" />
			default:
				return <Circle className="w-4 h-4 text-[var(--vscode-descriptionForeground)]" />
		}
	}

	const getStepTypeIcon = (type: EditStepProps["type"]) => {
		switch (type) {
			case "create":
				return <Files className="w-4 h-4 text-[var(--vscode-testing-iconPassedForeground)]" />
			case "update":
				return <Files className="w-4 h-4 text-[var(--vscode-testing-iconQueuedForeground)]" />
			case "delete":
				return <X className="w-4 h-4 text-[var(--vscode-testing-iconFailedForeground)]" />
			case "move":
				return <Files className="w-4 h-4 text-[var(--vscode-testing-iconQueuedForeground)]" />
		}
	}

	const getProgress = () => {
		if (steps.length === 0) return 0
		const completed = steps.filter((s) => s.status === "completed").length
		return Math.round((completed / steps.length) * 100)
	}

	const canExecute = status === "pending" || status === "in-progress"

	const handleExecuteStep = (e: React.MouseEvent, stepId: string) => {
		e.stopPropagation()
		onExecuteStep?.(stepId)
	}

	const handleExecuteAll = (e: React.MouseEvent) => {
		e.stopPropagation()
		onExecuteAll?.()
	}

	const handleCancel = (e: React.MouseEvent) => {
		e.stopPropagation()
		onCancel?.()
	}

	return (
		<div className="flex flex-col gap-3 p-4 rounded-lg border border-vscode-widget-border bg-vscode-widget-background">
			{/* Plan Header */}
			<div className="flex items-start justify-between gap-3">
				<div className="flex items-start gap-3 flex-1 min-w-0">
					{/* Status Icon */}
					<div className="flex-shrink-0 mt-0.5">{getStatusIcon()}</div>

					{/* Plan Info */}
					<div className="flex-1 min-w-0">
						<h3 className="text-base font-semibold text-vscode-foreground truncate">{title}</h3>
						<p className="text-sm text-vscode-descriptionForeground mt-1 line-clamp-2">{description}</p>

						{/* Progress Bar */}
						<div className="mt-3">
							<div className="flex items-center justify-between gap-2 mb-1">
								<span className="text-xs text-vscode-descriptionForeground">
									Progress: {steps.filter((s) => s.status === "completed").length}/{steps.length}{" "}
									steps
								</span>
								<span className="text-xs font-medium text-vscode-foreground">{getProgress()}%</span>
							</div>
							<div className="w-full h-1.5 rounded-full bg-vscode-progressBar-background overflow-hidden">
								<div
									className="h-full rounded-full bg-[var(--vscode-progressBar-foreground)] transition-all duration-300"
									style={{ width: `${getProgress()}%` }}
								/>
							</div>
						</div>
					</div>
				</div>

				{/* Actions */}
				<div className="flex items-center gap-2 flex-shrink-0">
					{canExecute && (
						<>
							<button
								className="flex items-center gap-1 px-3 py-1.5 rounded bg-[var(--vscode-button-primaryBackground)] hover:bg-[var(--vscode-button-primaryHoverBackground)] text-[var(--vscode-button-primaryForeground)] text-sm font-medium transition-colors"
								onClick={handleExecuteAll}
								title="Execute all steps">
								<Play className="w-4 h-4" />
								<span className="hidden sm:inline">Execute All</span>
							</button>
							<button
								className="flex items-center gap-1 px-3 py-1.5 rounded bg-[var(--vscode-button-secondaryBackground)] hover:bg-[var(--vscode-button-secondaryHoverBackground)] text-[var(--vscode-button-secondaryForeground)] text-sm font-medium transition-colors"
								onClick={handleCancel}
								title="Cancel plan">
								<X className="w-4 h-4" />
							</button>
						</>
					)}
				</div>
			</div>

			{/* Steps List */}
			<div className="flex flex-col gap-2 mt-4">
				<div className="flex items-center justify-between">
					<span className="text-sm font-medium text-vscode-foreground">Steps</span>
					<span className={`text-xs ${getStatusColor()}`}>{status}</span>
				</div>

				<div className="flex flex-col gap-2">
					{steps.map((step) => (
						<div
							key={step.id}
							className="group flex flex-col gap-2 p-3 rounded-lg border border-vscode-widget-border hover:border-vscode-focusBorder bg-vscode-widget-secondaryBackground hover:bg-vscode-editor-background cursor-pointer transition-all duration-200"
							onClick={() => onStepClick?.(step.id)}>
							{/* Step Header */}
							<div className="flex items-center justify-between gap-2">
								<div className="flex items-center gap-2 flex-1 min-w-0">
									{/* Step Status */}
									<div className="flex-shrink-0">{getStepStatusIcon(step.status)}</div>

									{/* Step Type */}
									<div className="flex-shrink-0">{getStepTypeIcon(step.type)}</div>

									{/* Step Info */}
									<div className="flex items-center gap-2 min-w-0 flex-1">
										<span className="text-xs text-vscode-descriptionForeground">
											Step {step.order}
										</span>
										<span className="text-sm font-medium text-vscode-foreground truncate">
											{step.title}
										</span>
									</div>

									{/* Files Count */}
									{step.files.length > 0 && (
										<div className="flex items-center gap-1 px-2 py-0.5 rounded bg-vscode-widget-background text-xs text-vscode-descriptionForeground">
											<Files className="w-3 h-3" />
											<span>{step.files.length}</span>
										</div>
									)}

									{/* Expand Button */}
									<button
										className="flex-shrink-0 p-1 rounded hover:bg-vscode-toolbar-hoverBackground transition-colors"
										onClick={(e) => {
											e.stopPropagation()
											toggleStep(step.id)
										}}
										aria-label={expandedSteps.has(step.id) ? "Collapse" : "Expand"}>
										{expandedSteps.has(step.id) ? (
											<ChevronDown className="w-4 h-4 text-vscode-foreground" />
										) : (
											<ChevronRight className="w-4 h-4 text-vscode-foreground" />
										)}
									</button>
								</div>

								{/* Execute Button */}
								{step.status === "pending" && canExecute && (
									<button
										className="flex-shrink-0 p-1.5 rounded bg-[var(--vscode-button-primaryBackground)] hover:bg-[var(--vscode-button-primaryHoverBackground)] text-[var(--vscode-button-primaryForeground)] transition-colors"
										onClick={(e) => handleExecuteStep(e, step.id)}
										title="Execute step">
										<Play className="w-3.5 h-3.5" />
									</button>
								)}
							</div>

							{/* Expanded Content */}
							{expandedSteps.has(step.id) && (
								<div className="mt-2 pt-2 border-t border-vscode-widget-border">
									{/* Description */}
									<p className="text-sm text-vscode-descriptionForeground mb-2">{step.description}</p>

									{/* Files */}
									{step.files.length > 0 && (
										<div className="flex flex-col gap-1">
											<span className="text-xs font-medium text-vscode-foreground">Files:</span>
											{step.files.map((file, fileIndex) => (
												<div
													key={fileIndex}
													className="flex items-center gap-2 text-xs text-vscode-descriptionForeground">
													<span className="font-medium">{file.changeType}:</span>
													<span className="truncate">{file.filePath}</span>
												</div>
											))}
										</div>
									)}

									{/* Dependencies */}
									{step.dependencies.length > 0 && (
										<div className="mt-2 flex items-center gap-2">
											<AlertTriangle className="w-3 h-3 text-[var(--vscode-editorWarning-foreground)]" />
											<span className="text-xs text-vscode-descriptionForeground">
												Depends on {step.dependencies.length} step
												{step.dependencies.length > 1 ? "s" : ""}
											</span>
										</div>
									)}
								</div>
							)}
						</div>
					))}
				</div>
			</div>

			{/* Footer */}
			<div className="flex items-center justify-between pt-3 border-t border-vscode-widget-border text-xs text-vscode-descriptionForeground">
				<span>Created: {new Date(createdAt).toLocaleString()}</span>
				<span>Updated: {new Date(updatedAt).toLocaleString()}</span>
			</div>
		</div>
	)
}

export interface EditPlanListProps {
	plans: EditPlanProps[]
	onPlanClick?: (planId: string) => void
	onExecuteStep?: (planId: string, stepId: string) => void
	onExecuteAll?: (planId: string) => void
	onCancel?: (planId: string) => void
}

export function EditPlanList({ plans, onExecuteStep, onExecuteAll, onCancel }: EditPlanListProps) {
	if (plans.length === 0) {
		return (
			<div className="flex flex-col items-center justify-center p-8 text-center">
				<Files className="w-12 h-12 text-vscode-descriptionForeground mb-3" />
				<p className="text-sm text-vscode-descriptionForeground">No edit plans yet</p>
				<p className="text-xs text-vscode-descriptionForeground mt-1">
					Create a plan to start managing multi-file changes
				</p>
			</div>
		)
	}

	return (
		<div className="flex flex-col gap-3">
			{plans.map((plan) => (
				<EditPlan
					key={plan.id}
					{...plan}
					onExecuteStep={(stepId) => onExecuteStep?.(plan.id, stepId)}
					onExecuteAll={() => onExecuteAll?.(plan.id)}
					onCancel={() => onCancel?.(plan.id)}
				/>
			))}
		</div>
	)
}
