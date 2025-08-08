import React from "react"
import { useTranslation } from "react-i18next"
import { Package } from "@roo/package"
import { buildNumber } from "@/utils/buildInfo"

interface VersionIndicatorProps {
	onClick: () => void
	className?: string
}

// 生成详细版本号格式：version (YYYYMMDD.001)
const getDetailedVersion = () => {
	const today = new Date()
	const year = today.getFullYear()
	const month = String(today.getMonth() + 1).padStart(2, "0")
	const day = String(today.getDate()).padStart(2, "0")
	const dateStr = `${year}${month}${day}`

	// 使用buildNumber作为流水号
	const serialNumber = buildNumber || "001"

	return `${Package.version} (${dateStr}.${serialNumber})`
}

const VersionIndicator: React.FC<VersionIndicatorProps> = ({ onClick, className = "" }) => {
	const { t } = useTranslation()
	const detailedVersion = getDetailedVersion()

	return (
		<button
			onClick={onClick}
			className={`text-xs text-vscode-descriptionForeground hover:text-vscode-foreground transition-colors cursor-pointer px-2 py-1 rounded border border-vscode-panel-border hover:border-vscode-focusBorder ${className}`}
			aria-label={t("chat:versionIndicator.ariaLabel", { version: detailedVersion })}>
			v{detailedVersion}
		</button>
	)
}

export default VersionIndicator
