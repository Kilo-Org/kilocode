import { getGitLabContext } from "../../../integrations/gitlab"

/**
 * Get GitLab integration section for system prompts
 * Only includes content if GitLab extension is active
 */
export function getGitLabIntegrationSection(): string {
	const gitlabContext = getGitLabContext()

	if (!gitlabContext) {
		return ""
	}

	return `====

GITLAB INTEGRATION

${gitlabContext}`
}
