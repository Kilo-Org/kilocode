export function getGitPushDescription(): string {
	return `## git_push
Description: Push the current branch to the remote repository. This tool is useful for general git workflows when you need to push your committed changes to the remote. Always ask for user approval before using this tool.

Parameters:
- No parameters required

Usage:
<git_push>
</git_push>

Example: Pushing changes to remote
<git_push>
</git_push>

Note: This will push the current branch to the remote repository. Make sure you have committed your changes before pushing.`
}
