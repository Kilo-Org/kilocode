import { vscode } from "@/utils/vscode"
import { Button } from "@/components/ui"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { useState } from "react" // kilocode_change

// kilocode_change begin
export const ExportButton = ({ itemId, hasFamily }: { itemId: string; hasFamily?: boolean }) => {
	const { t } = useAppTranslation()
	const [showMenu, setShowMenu] = useState(false)

	// TODO: we are re-inventing the wheel here, we should use a proper context menu component
	const handleExportTask = (e: React.MouseEvent) => {
		e.stopPropagation()
		vscode.postMessage({ type: "exportTaskWithId", text: itemId })
		setShowMenu(false)
	}

	const handleExportFamily = (e: React.MouseEvent) => {
		e.stopPropagation()
		vscode.postMessage({ type: "exportTaskFamilyWithId", text: itemId })
		setShowMenu(false)
	}

	const handleButtonClick = (e: React.MouseEvent) => {
		e.stopPropagation()
		if (hasFamily) {
			setShowMenu(!showMenu)
		} else {
			handleExportTask(e)
		}
	}

	return (
		<div className="relative">
			<Button
				data-testid="export"
				variant="ghost"
				size={hasFamily ? "iconChevron" : "icon"}
				title={hasFamily ? t("history:exportOptions") : t("history:exportTask")}
				onClick={handleButtonClick}>
				<span className="codicon codicon-desktop-download" />
				{hasFamily && <span className="codicon codicon-chevron-down text-xs -ml-2" />}
			</Button>

			{hasFamily && showMenu && (
				<div className="absolute right-0 top-full mt-1 bg-vscode-dropdown-background border border-vscode-dropdown-border rounded shadow-lg z-50 min-w-48">
					<button
						className="w-full px-3 py-2 text-left text-sm hover:bg-vscode-list-hoverBackground text-vscode-dropdown-foreground"
						onClick={handleExportTask}>
						{t("history:exportSingleTask")}
					</button>
					<button
						className="w-full px-3 py-2 text-left text-sm hover:bg-vscode-list-hoverBackground text-vscode-dropdown-foreground"
						onClick={handleExportFamily}>
						{t("history:exportTaskFamily")}
					</button>
				</div>
			)}

			{showMenu && <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />}
		</div>
	)
}
// kilocode_change end
