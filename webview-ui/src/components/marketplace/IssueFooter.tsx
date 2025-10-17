import React from "react"
import { Trans } from "react-i18next"
import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { REPOSITORY_URL } from "@/constants/repository"

export const IssueFooter: React.FC = () => {
	return (
		<div className="text-xs text-vscode-descriptionForeground p-3">
			<Trans i18nKey="marketplace:footer.issueText">
				<VSCodeLink
					href={`${REPOSITORY_URL}/issues/new?template=marketplace.yml`}
					style={{ display: "inline", fontSize: "inherit" }}>
					Open a GitHub issue
				</VSCodeLink>
			</Trans>
		</div>
	)
}
