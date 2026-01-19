// kilocode_change new file

import React from "react"
import { SkillMarketplaceItem } from "@roo-code/types"
import { vscode } from "@/utils/vscode"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { Button } from "@/components/ui/button"

interface SkillItemCardProps {
	skill: SkillMarketplaceItem
}

export const SkillItemCard: React.FC<SkillItemCardProps> = ({ skill }) => {
	const { t } = useAppTranslation()

	const handleViewOnGitHub = () => {
		vscode.postMessage({ type: "openExternal", url: skill.githubUrl })
	}

	const { displayName, displayCategory } = skill

	return (
		<div className="border border-vscode-panel-border rounded-sm p-3 bg-vscode-editor-background">
			<div className="flex gap-2 items-start justify-between">
				<div className="flex gap-2 items-start">
					<div>
						<h3 className="text-lg font-semibold text-vscode-foreground mt-0 mb-1 leading-none">
							<Button
								variant="link"
								className="p-0 h-auto text-lg font-semibold text-vscode-foreground hover:underline"
								onClick={handleViewOnGitHub}>
								{displayName}
							</Button>
						</h3>
					</div>
				</div>
				<div className="flex items-center gap-1">
					<Button
						size="sm"
						variant="secondary"
						className="text-xs h-5 py-0 px-2"
						onClick={handleViewOnGitHub}>
						{t("marketplace:skills.viewOnGitHub")}
					</Button>
				</div>
			</div>

			<p className="my-2 text-vscode-foreground">{skill.description}</p>

			{/* Category badge */}
			<div className="relative flex flex-wrap gap-1 my-2">
				<span className="text-xs px-2 py-0.5 rounded-sm h-5 flex items-center bg-vscode-badge-background text-vscode-badge-foreground">
					{displayCategory}
				</span>
			</div>
		</div>
	)
}
