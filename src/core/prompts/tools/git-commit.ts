export function getGitCommitDescription(): string {
	return `## git_commit
Description: Stage all changes and commit them with a descriptive message. This tool is useful for GitLab workflows when you need to commit your changes before pushing. Always ask for user approval before using this tool.

Parameters:
- commit_message: (required) A clear, descriptive commit message that explains what changes were made. Should follow best practices for commit messages.

Usage:
<git_commit>
<commit_message>Your commit message here</commit_message>
</git_commit>

Example: Committing a new feature
<git_commit>
<commit_message>Add user authentication with JWT tokens</commit_message>
</git_commit>

Example: Committing a bug fix
<git_commit>
<commit_message>Fix validation error in login form</commit_message>
</git_commit>

Example: Committing documentation updates
<git_commit>
<commit_message>Update README with installation instructions</commit_message>
</git_commit>`
}
