import os from "os"
import * as path from "path"
import fs from "fs/promises"
import * as vscode from "vscode"
import { fileExistsAtPath } from "../../utils/fs"
import { openFile } from "../../integrations/misc/open-file"
import { getWorkspacePath } from "../../utils/path"
import type { ContextProxy } from "../config/ContextProxy"
import type { ClineRulesToggles } from "../../shared/cline-rules"
import { t } from "../../i18n"
import { GlobalFileNames } from "../../shared/globalFileNames"
import { allowedExtensions } from "../../shared/kilocode/rules"

export interface RulesData {
	globalRules: ClineRulesToggles
	localRules: ClineRulesToggles
	globalWorkflows: ClineRulesToggles
	localWorkflows: ClineRulesToggles
}

export async function getEnabledRules(
	workspacePath: string,
	contextProxy: ContextProxy,
	context: vscode.ExtensionContext,
	mode?: string,
): Promise<RulesData> {
	const homedir = os.homedir()
	const globalRulesToggles = ((await contextProxy.getGlobalState("globalRulesToggles")) as ClineRulesToggles) || {}
	const localRulesToggles =
		((await contextProxy.getWorkspaceState(context, "localRulesToggles")) as ClineRulesToggles) || {}

	const globalRulesBase = path.join(homedir, GlobalFileNames.kiloRules)
	const localRulesBase = path.join(workspacePath, GlobalFileNames.kiloRules)

	const [globalRules, localRules] = await Promise.all([
		getEnabledRulesFromDirectory(globalRulesBase, globalRulesToggles),
		getEnabledRulesFromDirectory(localRulesBase, localRulesToggles),
	])

	// Also include mode-specific rules directories (e.g. .kilocode/rules-code/)
	if (mode) {
		const globalModeRulesDir = path.join(homedir, ".kilocode", `rules-${mode}`)
		const localModeRulesDir = path.join(workspacePath, ".kilocode", `rules-${mode}`)

		const [globalModeRules, localModeRules] = await Promise.all([
			getEnabledRulesFromDirectory(globalModeRulesDir, globalRulesToggles),
			getEnabledRulesFromDirectory(localModeRulesDir, localRulesToggles),
		])

		Object.assign(globalRules, globalModeRules)
		Object.assign(localRules, localModeRules)
	}

	return {
		globalRules,
		localRules,
		globalWorkflows: await getEnabledRulesFromDirectory(
			path.join(os.homedir(), GlobalFileNames.workflows),
			((await contextProxy.getGlobalState("globalWorkflowToggles")) as ClineRulesToggles) || {},
		),
		localWorkflows: await getEnabledRulesFromDirectory(
			path.join(workspacePath, GlobalFileNames.workflows),
			((await contextProxy.getWorkspaceState(context, "localWorkflowToggles")) as ClineRulesToggles) || {},
		),
	}
}

async function getEnabledRulesFromDirectory(
	dirPath: string,
	toggleState: ClineRulesToggles = {},
): Promise<ClineRulesToggles> {
	const exists = await fileExistsAtPath(dirPath)
	if (!exists) {
		return {}
	}

	const files = await fs.readdir(dirPath, { withFileTypes: true })
	const rules: ClineRulesToggles = {}

	for (const file of files) {
		if (file.isFile() && allowedExtensions.some((ext) => file.name.toLowerCase().endsWith(ext))) {
			const filePath = path.join(dirPath, file.name)
			rules[filePath] = toggleState[filePath] ?? true
		}
	}

	return rules
}

export async function toggleWorkflow(
	workflowPath: string,
	enabled: boolean,
	isGlobal: boolean,
	contextProxy: ContextProxy,
	context: vscode.ExtensionContext,
): Promise<void> {
	if (isGlobal) {
		const toggles = ((await contextProxy.getGlobalState("globalWorkflowToggles")) as ClineRulesToggles) || {}
		toggles[workflowPath] = enabled
		await contextProxy.updateGlobalState("globalWorkflowToggles", toggles)
	} else {
		const toggles =
			((await contextProxy.getWorkspaceState(context, "localWorkflowToggles")) as ClineRulesToggles) || {}
		toggles[workflowPath] = enabled
		await contextProxy.updateWorkspaceState(context, "localWorkflowToggles", toggles)
	}
}

export async function toggleRule(
	rulePath: string,
	enabled: boolean,
	isGlobal: boolean,
	contextProxy: ContextProxy,
	context: vscode.ExtensionContext,
): Promise<void> {
	if (isGlobal) {
		const toggles = ((await contextProxy.getGlobalState("globalRulesToggles")) as ClineRulesToggles) || {}
		toggles[rulePath] = enabled
		await contextProxy.updateGlobalState("globalRulesToggles", toggles)
	} else {
		const toggles =
			((await contextProxy.getWorkspaceState(context, "localRulesToggles")) as ClineRulesToggles) || {}
		toggles[rulePath] = enabled
		await contextProxy.updateWorkspaceState(context, "localRulesToggles", toggles)
	}
}

function getRuleDirectoryPath(baseDir: string, ruleType: "rule" | "workflow") {
	return ruleType === "workflow"
		? path.join(baseDir, GlobalFileNames.workflows)
		: path.join(baseDir, GlobalFileNames.kiloRules)
}

export async function createRuleFile(
	filename: string,
	isGlobal: boolean,
	ruleType: "rule" | "workflow",
): Promise<void> {
	const workspacePath = getWorkspacePath()
	if (!workspacePath && !isGlobal) {
		vscode.window.showErrorMessage(t("kilocode:rules.errors.noWorkspaceFound"))
		return
	}

	const rulesDir = isGlobal
		? getRuleDirectoryPath(os.homedir(), ruleType)
		: getRuleDirectoryPath(workspacePath, ruleType)

	await fs.mkdir(rulesDir, { recursive: true })

	const filePath = path.join(rulesDir, filename)

	if (await fileExistsAtPath(filePath)) {
		vscode.window.showErrorMessage(t("kilocode:rules.errors.fileAlreadyExists", { filename }))
		return
	}

	const baseFileName = path.basename(filename)
	const content = ruleType === "workflow" ? workflowTemplate(baseFileName) : ruleTemplate(baseFileName)

	await fs.writeFile(filePath, content, "utf8")
	await openFile(filePath)
}

function workflowTemplate(baseFileName: string) {
	return `# ${baseFileName}

${t("kilocode:rules.templates.workflow.description")}

${t("kilocode:rules.templates.workflow.stepsHeader")}

1. ${t("kilocode:rules.templates.workflow.step1")}
2. ${t("kilocode:rules.templates.workflow.step2")}
`
}

function ruleTemplate(baseFileName: string) {
	return `# ${baseFileName}

${t("kilocode:rules.templates.rule.description")}

${t("kilocode:rules.templates.rule.guidelinesHeader")}

- ${t("kilocode:rules.templates.rule.guideline1")}
- ${t("kilocode:rules.templates.rule.guideline2")}
`
}

export async function deleteRuleFile(rulePath: string): Promise<void> {
	const deleteAction = t("kilocode:rules.actions.delete")
	const filename = path.basename(rulePath)
	const result = await vscode.window.showWarningMessage(
		t("kilocode:rules.actions.confirmDelete", { filename }),
		{ modal: true },
		deleteAction,
	)

	if (result === deleteAction) {
		await fs.unlink(rulePath)
		vscode.window.showInformationMessage(t("kilocode:rules.actions.deleted", { filename }))
	}
}
