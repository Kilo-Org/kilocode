import { useTranslation } from "react-i18next"
import RulesToggleList from "./RulesToggleList"

interface RulesWorkflowsSectionProps {
	type: "rules" | "workflows"
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

	const globalSectionKey = type === "rules" ? "globalRules" : "globalWorkflows"
	const workspaceSectionKey = type === "rules" ? "workspaceRules" : "workspaceWorkflows"

	return (
		<>
			<div className="mb-3">
				<div className="text-sm font-normal mb-2">{t(`kilocode:rules.sections.${globalSectionKey}`)}</div>
				<RulesToggleList
					rules={globalItems}
					toggleRule={toggleGlobal}
					listGap="small"
					isGlobal={true}
					ruleType={type}
					showNewRule={true}
					showNoRules={false}
				/>
			</div>

			<div style={{ marginBottom: -10 }}>
				<div className="text-sm font-normal mb-2">{t(`kilocode:rules.sections.${workspaceSectionKey}`)}</div>
				<RulesToggleList
					rules={localItems}
					toggleRule={toggleLocal}
					listGap="small"
					isGlobal={false}
					ruleType={type}
					showNewRule={true}
					showNoRules={false}
				/>
			</div>
		</>
	)
}

export default RulesWorkflowsSection
