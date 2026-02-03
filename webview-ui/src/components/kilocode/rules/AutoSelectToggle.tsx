import { useTranslation } from "react-i18next"
import { vscode } from "@/utils/vscode"

interface AutoSelectToggleProps {
	enabled: boolean
}

const AutoSelectToggle: React.FC<AutoSelectToggleProps> = ({ enabled }) => {
	const { t } = useTranslation()

	const handleToggle = () => {
		vscode.postMessage({
			type: "toggleAutoSelectRules",
			enabled: !enabled,
		})
	}

	return (
		<div className="mb-4 p-3 rounded bg-[var(--vscode-textCodeBlock-background)]">
			<div className="flex items-center justify-between">
				<div className="flex-1 mr-3">
					<div className="text-sm font-medium">{t("kilocode:rules.autoSelect.label")}</div>
					<div className="text-xs text-[var(--vscode-descriptionForeground)] mt-1">
						{t("kilocode:rules.autoSelect.description")}
					</div>
				</div>
				<div
					role="switch"
					aria-checked={enabled}
					tabIndex={0}
					className={`w-[36px] h-[18px] rounded-[9px] relative cursor-pointer transition-colors duration-200 flex items-center shrink-0 ${
						enabled
							? "bg-[var(--vscode-testing-iconPassed)] opacity-90"
							: "bg-[var(--vscode-titleBar-inactiveForeground)] opacity-50"
					}`}
					onClick={handleToggle}
					onKeyDown={(e) => {
						if (e.key === "Enter" || e.key === " ") {
							e.preventDefault()
							handleToggle()
						}
					}}>
					<div
						className={`w-[14px] h-[14px] bg-white border border-[#66666699] rounded-full absolute transition-all duration-200 ${
							enabled ? "left-[20px]" : "left-[2px]"
						}`}
					/>
				</div>
			</div>
		</div>
	)
}

export default AutoSelectToggle
