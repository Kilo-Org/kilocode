import { useTranslation } from "react-i18next"
import NewRuleRow from "./NewRuleRow"
import RuleRow from "./RuleRow"

const RulesToggleList = ({
	rules,
	toggleRule,
	isGlobal,
	ruleType,
}: {
	rules: [string, boolean][]
	toggleRule: (rulePath: string, enabled: boolean) => void
	isGlobal: boolean
	ruleType: "rule" | "workflow"
}) => {
	const { t } = useTranslation()
	return (
		<div className="flex flex-col gap-0">
			{rules.length > 0 ? (
				rules.map(([rulePath, enabled]) => (
					<RuleRow key={rulePath} rulePath={rulePath} enabled={enabled} toggleRule={toggleRule} />
				))
			) : (
				<div className="flex flex-col items-center gap-3 my-3 text-[var(--vscode-descriptionForeground)]">
					{ruleType === "workflow"
						? t("kilocode:rules.emptyState.noWorkflowsFound")
						: t("kilocode:rules.emptyState.noRulesFound")}
				</div>
			)}
			<NewRuleRow isGlobal={isGlobal} ruleType={ruleType} />
		</div>
	)
}

export default RulesToggleList
