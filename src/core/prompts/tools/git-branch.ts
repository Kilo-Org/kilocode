export function getGitBranchDescription(): string {
	return `## git_branch
Description: Create a new git branch from the current branch. This tool is useful for general git workflows when you need to create a feature branch before making changes. Always ask for user approval before using this tool.

Parameters:
- branch_name: (required) The name of the new branch to create. Should follow conventional commit (e.g., feature/add-login, fix/validation-bug, docs/update-readme)

Usage:
<git_branch>
<branch_name>Branch name here</branch_name>
</git_branch>

Example: Creating a feature branch
<git_branch>
<branch_name>feature/add-user-authentication</branch_name>
</git_branch>

Example: Creating a bugfix branch
<git_branch>
<branch_name>fix/login-validation</branch_name>
</git_branch>`
}
