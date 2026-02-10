import { useEffect, useState } from "react"
import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { useTranslation } from "react-i18next"

import { vscode } from "@/utils/vscode"

import RulesWorkflowsSection from "./RulesWorkflowsSection"

const sortedRules = (data: Record<string, unknown> | undefined) =>
	Object.entries(data || {})
		.map(([path, enabled]): [string, boolean] => [path, enabled as boolean])
		.sort(([a], [b]) => a.localeCompare(b))

interface DescriptionWithLinkProps {
	children: React.ReactNode
	href: string
	linkText: string
}

const DescriptionWithLink: React.FC<DescriptionWithLinkProps> = ({ children, href, linkText }) => (
	<p>
		{children}{" "}
		<VSCodeLink href={href} style={{ display: "inline" }} className="text-xs">
			{linkText}
		</VSCodeLink>
	</p>
)

type KiloRulesWorkflowsViewProps = {
	type: "rule" | "workflow"
}

const KiloRulesWorkflowsView = ({ type }: KiloRulesWorkflowsViewProps) => {
	const { t } = useTranslation()

	const [localRules, setLocalRules] = useState<[string, boolean][]>([])
	const [globalRules, setGlobalRules] = useState<[string, boolean][]>([])
	const [localWorkflows, setLocalWorkflows] = useState<[string, boolean][]>([])
	const [globalWorkflows, setGlobalWorkflows] = useState<[string, boolean][]>([])

	useEffect(() => {
		vscode.postMessage({ type: "refreshRules" })
	}, [])

	useEffect(() => {
		const handleMessage = (event: MessageEvent) => {
			const message = event.data
			if (message.type === "rulesData") {
				setLocalRules(sortedRules(message.localRules))
				setGlobalRules(sortedRules(message.globalRules))
				setLocalWorkflows(sortedRules(message.localWorkflows))
				setGlobalWorkflows(sortedRules(message.globalWorkflows))
			}
		}

		window.addEventListener("message", handleMessage)
		return () => window.removeEventListener("message", handleMessage)
	}, [])

	const toggleRule = (isGlobal: boolean, rulePath: string, enabled: boolean) => {
		vscode.postMessage({
			type: "toggleRule",
			rulePath,
			enabled,
			isGlobal,
		})
	}

	const toggleWorkflow = (isGlobal: boolean, workflowPath: string, enabled: boolean) => {
		vscode.postMessage({
			type: "toggleWorkflow",
			workflowPath,
			enabled,
			isGlobal,
		})
	}

	const isRules = type === "rule"

	return (
		<div className="px-5">
			<div className="text-xs text-[var(--vscode-descriptionForeground)] mb-4">
				{isRules ? (
					<DescriptionWithLink
						href="https://kilo.ai/docs/advanced-usage/custom-rules"
						linkText={t("kilocode:docs")}>
						{t("kilocode:rules.description.rules")}
					</DescriptionWithLink>
				) : (
					<DescriptionWithLink
						href="https://kilo.ai/docs/features/slash-commands/workflows"
						linkText={t("kilocode:docs")}>
						{t("kilocode:rules.description.workflows")}{" "}
						<span className="text-[var(--vscode-foreground)] font-bold">/workflow-name</span>{" "}
						{t("kilocode:rules.description.workflowsInChat")}
					</DescriptionWithLink>
				)}
			</div>

			<RulesWorkflowsSection
				type={type}
				globalItems={isRules ? globalRules : globalWorkflows}
				localItems={isRules ? localRules : localWorkflows}
				toggleGlobal={(path: string, enabled: boolean) =>
					isRules ? toggleRule(true, path, enabled) : toggleWorkflow(true, path, enabled)
				}
				toggleLocal={(path: string, enabled: boolean) =>
					isRules ? toggleRule(false, path, enabled) : toggleWorkflow(false, path, enabled)
				}
			/>
		</div>
	)
}

export default KiloRulesWorkflowsView
