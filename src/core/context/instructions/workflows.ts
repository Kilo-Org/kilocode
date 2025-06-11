import path from "path"
import os from "os"
import * as vscode from "vscode"
import { ClineRulesToggles } from "../../../shared/cline-rules"
import { ContextProxy } from "../../config/ContextProxy"
import { GlobalFileNames } from "../../../shared/globalFileNames"
import { synchronizeRuleToggles } from "./rule-helpers"

async function refreshLocalWorkflowToggles(
	proxy: ContextProxy,
	context: vscode.ExtensionContext,
	workingDirectory: string,
) {
	const workflowRulesToggles =
		((await proxy.getWorkspaceState(context, "localWorkflowToggles")) as ClineRulesToggles) || {}
	const workflowsDirPath = path.resolve(workingDirectory, GlobalFileNames.workflows)
	const updatedWorkflowToggles = await synchronizeRuleToggles(workflowsDirPath, workflowRulesToggles)
	await proxy.updateWorkspaceState(context, "localWorkflowToggles", updatedWorkflowToggles)
	return updatedWorkflowToggles
}

async function refreshGlobalWorkflowToggles(proxy: ContextProxy) {
	const globalWorkflowToggles = ((await proxy.getGlobalState("globalWorkflowToggles")) as ClineRulesToggles) || {}
	const globalWorkflowsDir = path.join(os.homedir(), GlobalFileNames.workflows)
	const updatedGlobalWorkflowToggles = await synchronizeRuleToggles(globalWorkflowsDir, globalWorkflowToggles)
	await proxy.updateGlobalState("globalWorkflowToggles", updatedGlobalWorkflowToggles)
	return updatedGlobalWorkflowToggles
}

export async function refreshWorkflowToggles(
	context: vscode.ExtensionContext,
	workingDirectory: string,
): Promise<{
	globalWorkflowToggles: ClineRulesToggles
	localWorkflowToggles: ClineRulesToggles
}> {
	const proxy = new ContextProxy(context)
	return {
		globalWorkflowToggles: await refreshGlobalWorkflowToggles(proxy),
		localWorkflowToggles: await refreshLocalWorkflowToggles(proxy, context, workingDirectory),
	}
}
