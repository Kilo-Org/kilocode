import React, { useEffect, useState } from "react"
import { vscode } from "@src/utils/vscode"

export const GitLabStatus: React.FC = () => {
	const [isActivated, setIsActivated] = useState<boolean>(false)

	useEffect(() => {
		// Send message to extension to check GitLab extension status
		vscode.postMessage({ type: "checkGitLabExtension" })

		// Listen for response
		const handleMessage = (event: MessageEvent) => {
			const message = event.data
			if (message.type === "gitlabExtensionStatus") {
				setIsActivated(message.value)
			}
		}

		window.addEventListener("message", handleMessage)

		// Set up polling to check GitLab extension status periodically
		const pollInterval = setInterval(() => {
			vscode.postMessage({ type: "checkGitLabExtension" })
		}, 2000)

		return () => {
			window.removeEventListener("message", handleMessage)
			clearInterval(pollInterval)
		}
	}, [])

	if (isActivated) {
		return <div className="px-3">GitLab extension is activated</div>
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
