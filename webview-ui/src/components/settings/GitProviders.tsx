import { HTMLAttributes, useEffect, useState } from "react"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { FolderGit2, ExternalLink } from "lucide-react"

import { vscode } from "@src/utils/vscode"

import { cn } from "@/lib/utils"

import { SectionHeader } from "./SectionHeader"
import { Section } from "./Section"
import { Button } from "@/components/ui"

interface GitProviderStatus {
	name: string
	displayName: string
	isActivated: boolean
	repositoryInfo?: {
		projectName: string
		currentBranch: string
		remoteUrl: string
		isGitRemote: boolean
	}
	extensionId?: string
	installUrl?: string
}

type GitProvidersProps = HTMLAttributes<HTMLDivElement> & {}

export const GitProviders = ({ className, ...props }: GitProvidersProps) => {
	const { t } = useAppTranslation()

	const [providers, setProviders] = useState<GitProviderStatus[]>([
		{
			name: "gitlab",
			displayName: "GitLab",
			isActivated: false,
			extensionId: "gitlab.gitlab-workflow",
			installUrl: "vscode:extension/gitlab.gitlab-workflow",
		},
		{
			name: "github",
			displayName: "GitHub",
			isActivated: false,
			extensionId: "GitHub.vscode-pull-request-github",
			installUrl: "vscode:extension/GitHub.vscode-pull-request-github",
		},
		{
			name: "bitbucket",
			displayName: "Bitbucket",
			isActivated: false,
			extensionId: "atlassian.atlascode",
			installUrl: "vscode:extension/atlassian.atlascode",
		},
		{
			name: "azure-devops",
			displayName: "Azure DevOps",
			isActivated: false,
			extensionId: "ms-vscode.azure-repos",
			installUrl: "vscode:extension/ms-vscode.azure-repos",
		},
	])

	useEffect(() => {
		const checkAllProviders = async () => {
			const updatedProviders = await Promise.all(
				providers.map(async (provider) => {
					try {
						const isActivated = await checkProviderStatus(provider.name)
						const repositoryInfo = isActivated ? await getRepositoryInfo(provider.name) : undefined

						return {
							...provider,
							isActivated,
							repositoryInfo,
						}
					} catch (error) {
						console.error(`Error checking ${provider.name} status:`, error)
						return provider
					}
				}),
			)
			setProviders(updatedProviders)
		}

		checkAllProviders()

		const interval = setInterval(checkAllProviders, 5000)
		return () => clearInterval(interval)
	}, [providers])

	const checkProviderStatus = async (providerName: string): Promise<boolean> => {
		return new Promise((resolve) => {
			const timeout = setTimeout(() => resolve(false), 2000)

			const handleMessage = (event: MessageEvent) => {
				const message = event.data
				if (message.type === `${providerName}ExtensionStatus`) {
					clearTimeout(timeout)
					window.removeEventListener("message", handleMessage)
					resolve(message.value)
				}
			}

			window.addEventListener("message", handleMessage)
			// For now, only GitLab is implemented in the extension
			if (providerName === "gitlab") {
				vscode.postMessage({ type: "checkGitLabExtension" })
			} else {
				// For other providers, assume not activated for now
				resolve(false)
			}
		})
	}

	const getRepositoryInfo = async (providerName: string): Promise<GitProviderStatus["repositoryInfo"]> => {
		return new Promise((resolve) => {
			const timeout = setTimeout(() => resolve(undefined), 2000)

			const handleMessage = (event: MessageEvent) => {
				const message = event.data
				if (message.type === `${providerName}RepositoryInfo`) {
					clearTimeout(timeout)
					window.removeEventListener("message", handleMessage)
					resolve(message.value)
				}
			}

			window.addEventListener("message", handleMessage)
			// For now, only GitLab is implemented in the extension
			if (providerName === "gitlab") {
				vscode.postMessage({ type: "getGitLabRepositoryInfo" })
			} else {
				// For other providers, return undefined for now
				resolve(undefined)
			}
		})
	}

	const getStatusIcon = (provider: GitProviderStatus) => {
		const backgroundClass = provider.isActivated
			? "bg-[var(--vscode-testing-iconPassed)]"
			: provider.extensionId
				? "bg-[var(--vscode-testing-iconFailed)]"
				: "bg-[var(--vscode-charts-yellow)]"

		return (
			<div className="flex-shrink-0">
				<div className={`w-[8px] h-[8px] rounded-[50%] ${backgroundClass}`} />
			</div>
		)
	}

	const getStatusText = (provider: GitProviderStatus) => {
		if (provider.isActivated) {
			return t("settings:gitProviders.status.activated")
		}
		if (provider.extensionId) {
			return t("settings:gitProviders.status.notInstalled")
		}
		return t("settings:gitProviders.status.notSupported")
	}

	return (
		<div className={cn("flex flex-col gap-2", className)} {...props}>
			<SectionHeader>
				<div className="flex items-center gap-2">
					<FolderGit2 className="w-4" />
					<div>{t("settings:sections.gitProviders")}</div>
				</div>
			</SectionHeader>

			<Section>
				<div className="space-y-4">
					<div className="text-sm text-vscode-descriptionForeground">
						{t("settings:gitProviders.description")}
					</div>

					<div className="space-y-3">
						{providers.map((provider) => (
							<div
								key={provider.name}
								className="flex flex-col gap-3 p-4 border border-vscode-panel-border rounded-sm p-3 bg-vscode-editor-background">
								<div className="flex items-center justify-between">
									<div className="flex items-center gap-3 min-w-0 flex-1">
										<div className="min-w-0">
											<div className="flex items-center gap-3">
												{getStatusIcon(provider)}
												<div className="font-medium text-vscode-foreground">
													{provider.displayName}
												</div>
											</div>
											<div className="text-sm text-vscode-descriptionForeground">
												{getStatusText(provider)}
											</div>
										</div>
										{!provider.isActivated && provider.installUrl && (
											<Button
												size="sm"
												variant="default"
												className="text-xs h-5 py-0 px-2 flex-shrink-0 whitespace-nowrap"
												onClick={() =>
													vscode.postMessage({
														type: "openExternal",
														url: provider.installUrl,
													})
												}>
												<ExternalLink className="w-3 h-3" />
												{t("settings:gitProviders.install")}
											</Button>
										)}
									</div>
								</div>

								{provider.isActivated && provider.repositoryInfo && (
									<div className="space-y-2">
										<div className="text-sm">
											<div className="flex items-center gap-2">
												<span className="font-medium text-vscode-foreground max-w-10">
													{t("settings:gitProviders.repository.project")}:
												</span>
												<code className="px-2 py-1 bg-vscode-textBlockQuote-background rounded text-xs break-all">
													{provider.repositoryInfo.projectName}
												</code>
											</div>
											<div className="flex items-center gap-2 mt-1">
												<span className="font-medium text-vscode-foreground max-w-10">
													{t("settings:gitProviders.repository.branch")}:
												</span>
												<code className="px-2 py-1 bg-vscode-textBlockQuote-background rounded text-xs break-all">
													{provider.repositoryInfo.currentBranch}
												</code>
											</div>
											<div className="flex items-center gap-2 mt-1">
												<span className="font-medium text-vscode-foreground max-w-10">
													{t("settings:gitProviders.repository.remote")}:
												</span>
												<code className="px-2 py-1 bg-vscode-textBlockQuote-background rounded text-xs break-all">
													{provider.repositoryInfo.remoteUrl}
												</code>
											</div>
										</div>
									</div>
								)}
							</div>
						))}
					</div>

					<div className="mt-2 p-4 bg-vscode-textBlockQuote-background rounded-md">
						<div className="flex items-start gap-3">
							<div className="text-sm">
								<div className="flex items-center gap-4 font-bold">
									<span className="codicon codicon-settings-gear" />
									<div className="font-medium text-vscode-foreground">
										{t("settings:gitProviders.configuration.title")}
									</div>
								</div>
								<div className="text-vscode-descriptionForeground">
									<p>{t("settings:gitProviders.configuration.description")}</p>
									<ul className="list-disc list-inside space-y-1">
										<li>{t("settings:gitProviders.configuration.features.pr")}</li>
										<li>{t("settings:gitProviders.configuration.features.issues")}</li>
										<li>{t("settings:gitProviders.configuration.features.commits")}</li>
										<li>{t("settings:gitProviders.configuration.features.status")}</li>
									</ul>
								</div>
							</div>
						</div>
					</div>
				</div>
			</Section>
		</div>
	)
}
