import { GitLabIntegrationService } from "../../../integrations/git-providers/gitlab"

/**
 * Get Git provider integration section for system prompts
 * Only includes content if the provider extension is active
 */
export function getGitProviderIntegrationSection(): string {
	// Keep this provider for now hardcoded
	// tbd how to handle configurable support
	// of multiple git providers
	const provider = GitLabIntegrationService.getInstance()

	const context = provider.getContext()
	if (!context) {
		return ""
	}

	return `====

${provider.getName().toUpperCase()} INTEGRATION

${context}`
}
