// kilocode_change - new file: Component to display individual release note items
import React from "react"
import { ReleaseItem } from "../../types/release-notes"
import { REPOSITORY_URL } from "../../constants/repository"

interface ReleaseItemProps {
	item: ReleaseItem
}

export const ReleaseItemComponent: React.FC<ReleaseItemProps> = ({ item }) => {
	return (
		<div className="mb-2">
			<div className="text-sm text-vscode-editor-foreground">
				• {item.description}
				{item.prNumber && (
					<a
						href={`${REPOSITORY_URL}/pull/${item.prNumber}`}
						target="_blank"
						rel="noopener noreferrer"
						className="ml-2 text-xs text-vscode-textLink-foreground hover:text-vscode-textLink-activeForeground underline">
						#{item.prNumber}
					</a>
				)}
				{item.commitHash && (
					<a
						href={`${REPOSITORY_URL}/commit/${item.commitHash}`}
						target="_blank"
						rel="noopener noreferrer"
						className="ml-1 text-xs text-vscode-textLink-foreground hover:text-vscode-textLink-activeForeground underline font-mono">
						{item.commitHash}
					</a>
				)}
				{item.author && (
					<span className="ml-1 text-xs text-vscode-descriptionForeground">
						by{" "}
						<a
							href={`https://github.com/${item.author}`}
							target="_blank"
							rel="noopener noreferrer"
							className="text-vscode-textLink-foreground hover:text-vscode-textLink-activeForeground underline">
							@{item.author}
						</a>
					</span>
				)}
			</div>
			{item.details && (
				<div className="ml-4 mt-1 text-xs text-vscode-descriptionForeground whitespace-pre-line">
					{item.details}
				</div>
			)}
		</div>
	)
}
