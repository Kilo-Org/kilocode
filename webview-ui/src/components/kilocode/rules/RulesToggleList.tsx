import NewRuleRow from "./NewRuleRow"
import RuleRow from "./RuleRow"

const RulesToggleList = ({
	rules,
	toggleRule,
	isGlobal,
	ruleType,
	disabled,
}: {
	rules: [string, boolean][]
	toggleRule: (rulePath: string, enabled: boolean) => void
	isGlobal: boolean
	ruleType: "rule" | "workflow"
	disabled?: boolean
}) => (
	<div className="flex flex-col gap-0">
		{rules.length > 0 &&
			rules.map(([rulePath, enabled]) => (
				<RuleRow
					key={rulePath}
					rulePath={rulePath}
					enabled={enabled && !disabled}
					toggleRule={toggleRule}
					disabled={disabled}
				/>
			))}
		<NewRuleRow isGlobal={isGlobal} ruleType={ruleType} />
	</div>
)

export default RulesToggleList
