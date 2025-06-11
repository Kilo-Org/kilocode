import NewRuleRow from "./NewRuleRow"
import RuleRow from "./RuleRow"

const RulesToggleList = ({
	rules,
	toggleRule,
	isGlobal,
	ruleType,
	showNewRule,
	showNoRules,
}: {
	rules: [string, boolean][]
	toggleRule: (rulePath: string, enabled: boolean) => void
	isGlobal: boolean
	ruleType: "rules" | "workflows"
	showNewRule: boolean
	showNoRules: boolean
}) => {
	return (
		<div className="flex flex-col gap-0">
			{rules.length > 0 ? (
				<>
					{rules.map(([rulePath, enabled]) => (
						<RuleRow key={rulePath} rulePath={rulePath} enabled={enabled} toggleRule={toggleRule} />
					))}
					{showNewRule && <NewRuleRow isGlobal={isGlobal} ruleType={ruleType} />}
				</>
			) : (
				<>
					{showNoRules && (
						<div className="flex flex-col items-center gap-3 my-3 text-[var(--vscode-descriptionForeground)]">
							{ruleType === "workflows" ? "No workflows found" : "No rules found"}
						</div>
					)}
					{showNewRule && <NewRuleRow isGlobal={isGlobal} ruleType={ruleType} />}
				</>
			)}
		</div>
	)
}

export default RulesToggleList
