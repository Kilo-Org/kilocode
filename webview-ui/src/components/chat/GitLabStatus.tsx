import React, { useEffect, useState } from "react"
import { vscode } from "@src/utils/vscode"

interface GitLabRepositoryInfo {
	remoteUrl: string
	projectName: string
	currentBranch: string
	isGitLabRemote: boolean
}

export const GitLabStatus: React.FC = () => {
	const [isActivated, setIsActivated] = useState<boolean>(false)
	const [repositoryInfo, setRepositoryInfo] = useState<GitLabRepositoryInfo | null>(null)

	useEffect(() => {
		// Send message to extension to check GitLab extension status
		vscode.postMessage({ type: "checkGitLabExtension" })

		// Listen for response
		const handleMessage = (event: MessageEvent) => {
			const message = event.data
			if (message.type === "gitlabExtensionStatus") {
				setIsActivated(message.value)
			} else if (message.type === "gitlabRepositoryInfo") {
				setRepositoryInfo(message.value)
			}
		}

		window.addEventListener("message", handleMessage)

		// Set up polling to check GitLab extension status and repository info periodically
		const pollInterval = setInterval(() => {
			vscode.postMessage({ type: "checkGitLabExtension" })
			vscode.postMessage({ type: "getGitLabRepositoryInfo" })
		}, 2000)

		// Initial repository info request
		vscode.postMessage({ type: "getGitLabRepositoryInfo" })

		return () => {
			window.removeEventListener("message", handleMessage)
			clearInterval(pollInterval)
		}
	}, [])

	if (isActivated) {
		return (
			<div className="px-3 space-y-2">
				<div className="text-green-600 font-medium">GitLab extension is activated</div>
				{repositoryInfo && (
					<div className="text-sm text-gray-600 space-y-1">
						<div>
							<strong>Project:</strong> {repositoryInfo.projectName}
						</div>
						<div>
							<strong>Branch:</strong> {repositoryInfo.currentBranch}
						</div>
						<div>
							<strong>Remote:</strong> {repositoryInfo.remoteUrl}
						</div>
					</div>
				)}
			</div>
		)
	}

	return (
		<div className="px-3">
			GitLab extension can be installed{" "}
			<a
				href="vscode:extension/gitlab.gitlab-workflow"
				target="_blank"
				rel="noopener noreferrer"
				className="text-blue-500 underline">
				here
			</a>
		</div>
	)
}
