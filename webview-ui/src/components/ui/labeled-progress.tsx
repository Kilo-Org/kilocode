import { Progress } from "./progress"

interface LabeledProgressProps {
	label: string
	currentValue: number
	limitValue: number
	className?: string
}

export const LabeledProgress = ({ label, currentValue, limitValue, className }: LabeledProgressProps) => {
	const percentage = limitValue > 0 ? (currentValue / limitValue) * 100 : 0

	return (
		<div className={className}>
			<Progress value={percentage} className="[&>div]:bg-vscode-button-background mt-1 h-1" />
			<div className="text-xs text-vscode-descriptionForeground mb-1 flex gap-2 justify-between">
				<span className="whitespace-nowrap align-end">{label}</span>
				<span className="whitespace-nowrap flex text-[10px] items-end">
					{currentValue} / {limitValue}
				</span>
			</div>
		</div>
	)
}
