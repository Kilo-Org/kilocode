import { useTranslation } from "react-i18next"
import RulesToggleList from "./RulesToggleList"

interface RulesWorkflowsSectionProps {
	type: "rule" | "workflow"
	globalItems: [string, boolean][]
	localItems: [string, boolean][]
	toggleGlobal: (path: string, enabled: boolean) => void
	toggleLocal: (path: string, enabled: boolean) => void
}

const RulesWorkflowsSection: React.FC<RulesWorkflowsSectionProps> = ({
	type,
	globalItems,
	localItems,
	toggleGlobal,
	toggleLocal,
}) => {
	const { t } = useTranslation()

	const globalSectionKey =
		type === "rule" ? "kilocode:rules.sections.globalRules" : "kilocode:rules.sections.globalWorkflows"
	const workspaceSectionKey =
		type === "rule" ? "kilocode:rules.sections.workspaceRules" : "kilocode:rules.sections.workspaceWorkflows"

	return (
		<>
			<div className="mb-3">
				<div className="text-sm font-normal mb-2">{t(globalSectionKey)}</div>
				<RulesToggleList rules={globalItems} toggleRule={toggleGlobal} isGlobal={true} ruleType={type} />
			</div>

			<div style={{ marginBottom: -10 }}>
				<div className="text-sm font-normal mb-2">{t(workspaceSectionKey)}</div>
				<RulesToggleList rules={localItems} toggleRule={toggleLocal} isGlobal={false} ruleType={type} />
			</div>
		</>
	)
}

export default RulesWorkflowsSection
