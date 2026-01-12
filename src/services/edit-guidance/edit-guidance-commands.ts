// kilocode_change - new file

/**
 * Edit Guidance Commands for VSCode Extension
 * Registers edit guidance commands for multi-file code changes
 */

import * as vscode from "vscode"
import { getEditGuidanceService } from "./edit-guidance-service"
import { getPlanGeneratorService } from "./plan-generator"
import { getStepExecutorService } from "./step-executor"
import type { CreateEditPlanRequest, EditPlanGenerationRequest, ExecuteStepRequest } from "./types"

export function registerEditGuidanceCommands(context: vscode.ExtensionContext, outputChannel: vscode.OutputChannel) {
	const editGuidanceService = getEditGuidanceService()
	const planGeneratorService = getPlanGeneratorService()
	const stepExecutorService = getStepExecutorService()

	// Register all edit guidance commands
	const commands = [
		// Create new edit plan
		vscode.commands.registerCommand("kilo-code.editGuidance.createPlan", async () => {
			try {
				const title = await vscode.window.showInputBox({
					prompt: "Enter a title for the edit plan",
					placeHolder: "e.g., Refactor AuthService, Update Dependencies",
				})

				if (!title) {
					return // User cancelled
				}

				const description = await vscode.window.showInputBox({
					prompt: "Enter a description for the edit plan",
					placeHolder: "Describe what changes you want to make...",
				})

				if (!description) {
					return // User cancelled
				}

				const request: CreateEditPlanRequest = {
					title,
					description,
					type: "custom",
				}

				const response = await editGuidanceService.createPlan(request)

				outputChannel.appendLine(`[EditGuidance] Created plan: ${response.plan.id}`)
				vscode.window.showInformationMessage(`Edit plan "${title}" created successfully!`)

				// Show plan in sidebar
				await vscode.commands.executeCommand("kilo-code.editGuidance.showPlan", response.plan.id)
			} catch (error) {
				outputChannel.appendLine(`[EditGuidance] Error creating plan: ${error}`)
				vscode.window.showErrorMessage(`Failed to create edit plan: ${error}`)
			}
		}),

		// Generate edit plan from selection
		vscode.commands.registerCommand("kilo-code.editGuidance.generatePlanFromSelection", async () => {
			try {
				const editor = vscode.window.activeTextEditor
				if (!editor) {
					vscode.window.showWarningMessage("No active editor found")
					return
				}

				const selection = editor.selection
				if (selection.isEmpty) {
					vscode.window.showWarningMessage("No code selected")
					return
				}

				const selectedText = editor.document.getText(selection)
				const filePath = editor.document.uri.fsPath

				// Ask for scope
				const scope = await vscode.window.showQuickPick(
					[
						{ label: "Current file only", value: "current-file" },
						{ label: "Entire project", value: "project" },
						{ label: "Dependencies only", value: "dependencies" },
					] as const,
					{
						placeHolder: "Select analysis scope",
					},
				)

				if (!scope) {
					return // User cancelled
				}

				const request: EditPlanGenerationRequest = {
					initialChange: {
						filePath,
						changeType: "update",
						content: selectedText,
					},
					scope: scope.value,
					includeTests: true,
					includeDocumentation: true,
				}

				outputChannel.appendLine(`[EditGuidance] Generating plan for ${filePath}...`)

				await vscode.window.withProgress(
					{
						location: vscode.ProgressLocation.Notification,
						title: "Generating edit plan...",
						cancellable: true,
					},
					async (progress, token) => {
						try {
							progress.report({ increment: 0, message: "Analyzing code..." })

							const response = await planGeneratorService.generatePlan(request)

							progress.report({ increment: 100, message: "Complete!" })

							outputChannel.appendLine(
								`[EditGuidance] Generated plan with ${response.plan.steps.length} steps`,
							)

							if (response.warnings) {
								outputChannel.appendLine(`[EditGuidance] Warnings: ${response.warnings.join(", ")}`)
							}

							vscode.window.showInformationMessage(
								`Edit plan generated with ${response.plan.steps.length} steps!`,
							)

							// Show plan in sidebar
							await vscode.commands.executeCommand("kilo-code.editGuidance.showPlan", response.plan.id)
						} catch (error) {
							if (token.isCancellationRequested) {
								vscode.window.showInformationMessage("Plan generation cancelled")
							} else {
								throw error
							}
						}
					},
				)
			} catch (error) {
				outputChannel.appendLine(`[EditGuidance] Error generating plan: ${error}`)
				vscode.window.showErrorMessage(`Failed to generate edit plan: ${error}`)
			}
		}),

		// Show edit plan
		vscode.commands.registerCommand("kilo-code.editGuidance.showPlan", async (planId: string) => {
			try {
				const plan = await editGuidanceService.getPlan(planId)

				outputChannel.appendLine(`[EditGuidance] Showing plan: ${plan.id}`)

				// TODO: Show plan in sidebar panel
				// For now, show in information message
				const message = [
					`Edit Plan: ${plan.title}`,
					`Status: ${plan.status}`,
					`Steps: ${plan.steps.length}`,
					`Progress: ${plan.steps.filter((s) => s.status === "completed").length}/${plan.steps.length}`,
				].join("\n")

				vscode.window.showInformationMessage(message)
			} catch (error) {
				outputChannel.appendLine(`[EditGuidance] Error showing plan: ${error}`)
				vscode.window.showErrorMessage(`Failed to show edit plan: ${error}`)
			}
		}),

		// Execute edit plan step
		vscode.commands.registerCommand(
			"kilo-code.editGuidance.executeStep",
			async (planId: string, stepId: string) => {
				try {
					const plan = await editGuidanceService.getPlan(planId)
					const step = plan.steps.find((s) => s.id === stepId)

					if (!step) {
						vscode.window.showWarningMessage("Step not found")
						return
					}

					// Ask for confirmation
					const confirm = await vscode.window.showWarningMessage(
						`Execute step: ${step.title}?`,
						"Execute",
						"Cancel",
					)

					if (confirm !== "Execute") {
						return // User cancelled
					}

					const request: ExecuteStepRequest = {
						planId,
						stepId,
						options: {
							skipConfirmation: true,
							dryRun: false,
						},
					}

					outputChannel.appendLine(`[EditGuidance] Executing step ${stepId}...`)

					const response = await stepExecutorService.executeStep(step, request.options)

					if (response.success) {
						outputChannel.appendLine(`[EditGuidance] Step ${stepId} completed successfully`)
						vscode.window.showInformationMessage(`Step "${step.title}" completed!`)
					} else {
						outputChannel.appendLine(`[EditGuidance] Step ${stepId} failed`)
						vscode.window.showErrorMessage(`Step "${step.title}" failed!`)
					}

					if (response.conflicts) {
						outputChannel.appendLine(
							`[EditGuidance] Conflicts: ${response.conflicts.map((c) => c.description).join(", ")}`,
						)
					}

					if (response.warnings) {
						outputChannel.appendLine(`[EditGuidance] Warnings: ${response.warnings.join(", ")}`)
					}
				} catch (error) {
					outputChannel.appendLine(`[EditGuidance] Error executing step: ${error}`)
					vscode.window.showErrorMessage(`Failed to execute step: ${error}`)
				}
			},
		),

		// Execute all pending steps
		vscode.commands.registerCommand("kilo-code.editGuidance.executeAllSteps", async (planId: string) => {
			try {
				const plan = await editGuidanceService.getPlan(planId)
				const pendingSteps = plan.steps.filter((s) => s.status === "pending")

				if (pendingSteps.length === 0) {
					vscode.window.showInformationMessage("No pending steps to execute")
					return
				}

				// Ask for confirmation
				const confirm = await vscode.window.showWarningMessage(
					`Execute ${pendingSteps.length} pending steps?`,
					"Execute All",
					"Cancel",
				)

				if (confirm !== "Execute All") {
					return // User cancelled
				}

				outputChannel.appendLine(`[EditGuidance] Executing ${pendingSteps.length} steps...`)

				await vscode.window.withProgress(
					{
						location: vscode.ProgressLocation.Notification,
						title: "Executing edit plan...",
						cancellable: true,
					},
					async (progress, token) => {
						try {
							for (let i = 0; i < pendingSteps.length; i++) {
								if (token.isCancellationRequested) {
									break
								}

								const step = pendingSteps[i]
								progress.report({
									increment: (i / pendingSteps.length) * 100,
									message: `Executing step ${i + 1}/${pendingSteps.length}: ${step.title}`,
								})

								const request: ExecuteStepRequest = {
									planId,
									stepId: step.id,
									options: {
										skipConfirmation: true,
										dryRun: false,
									},
								}

								const response = await stepExecutorService.executeStep(step, request.options)

								if (!response.success) {
									throw new Error(`Step "${step.title}" failed`)
								}
							}

							progress.report({ increment: 100, message: "Complete!" })

							outputChannel.appendLine(`[EditGuidance] All steps completed`)
							vscode.window.showInformationMessage("All steps completed successfully!")
						} catch (error) {
							if (token.isCancellationRequested) {
								vscode.window.showInformationMessage("Execution cancelled")
							} else {
								throw error
							}
						}
					},
				)
			} catch (error) {
				outputChannel.appendLine(`[EditGuidance] Error executing steps: ${error}`)
				vscode.window.showErrorMessage(`Failed to execute steps: ${error}`)
			}
		}),

		// Cancel edit plan
		vscode.commands.registerCommand("kilo-code.editGuidance.cancelPlan", async (planId: string) => {
			try {
				const plan = await editGuidanceService.getPlan(planId)

				const confirm = await vscode.window.showWarningMessage(
					`Cancel edit plan "${plan.title}"?`,
					"Cancel",
					"Keep",
				)

				if (confirm !== "Cancel") {
					return // User cancelled
				}

				await editGuidanceService.cancelPlan(planId)

				outputChannel.appendLine(`[EditGuidance] Cancelled plan: ${planId}`)
				vscode.window.showInformationMessage(`Edit plan "${plan.title}" cancelled`)
			} catch (error) {
				outputChannel.appendLine(`[EditGuidance] Error cancelling plan: ${error}`)
				vscode.window.showErrorMessage(`Failed to cancel plan: ${error}`)
			}
		}),

		// List active plans
		vscode.commands.registerCommand("kilo-code.editGuidance.listActivePlans", async () => {
			try {
				const plans = await editGuidanceService.getActivePlans("default-user")

				if (plans.length === 0) {
					vscode.window.showInformationMessage("No active edit plans")
					return
				}

				outputChannel.appendLine(`[EditGuidance] Found ${plans.length} active plans`)

				const items = plans.map((plan) => ({
					label: plan.title,
					description: `${plan.status} - ${plan.steps.length} steps`,
					planId: plan.id,
				}))

				const selected = await vscode.window.showQuickPick(items, {
					placeHolder: "Select a plan to view",
				})

				if (selected) {
					await vscode.commands.executeCommand("kilo-code.editGuidance.showPlan", selected.planId)
				}
			} catch (error) {
				outputChannel.appendLine(`[EditGuidance] Error listing plans: ${error}`)
				vscode.window.showErrorMessage(`Failed to list plans: ${error}`)
			}
		}),

		// Show step details
		vscode.commands.registerCommand(
			"kilo-code.editGuidance.showStepDetails",
			async (planId: string, stepId: string) => {
				try {
					const plan = await editGuidanceService.getPlan(planId)
					const step = plan.steps.find((s) => s.id === stepId)

					if (!step) {
						vscode.window.showWarningMessage("Step not found")
						return
					}

					const details = [
						`Step: ${step.title}`,
						`Type: ${step.type}`,
						`Status: ${step.status}`,
						`Files: ${step.files.length}`,
						`Description: ${step.description}`,
					]

					if (step.dependencies.length > 0) {
						details.push(`Dependencies: ${step.dependencies.length}`)
					}

					vscode.window.showInformationMessage(details.join("\n"))
				} catch (error) {
					outputChannel.appendLine(`[EditGuidance] Error showing step details: ${error}`)
				}
			},
		),
	]

	// Register all commands
	commands.forEach((command) => {
		context.subscriptions.push(command)
	})

	outputChannel.appendLine("[EditGuidance] All edit guidance commands registered successfully")
}
