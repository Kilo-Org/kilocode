#!/usr/bin/env node

/**
 * Create a PR to sync main branch with rollback version
 *
 * This script:
 * 1. Calculates the rollback version from main's current version
 * 2. Creates a PR updating package.json and CHANGELOG.md
 * 3. Keeps main in sync with what was published
 *
 * Usage: Called from GitHub Actions workflow
 * Requires environment variables:
 *   GITHUB_TOKEN - GitHub token with repo permissions
 *   GITHUB_REPOSITORY - Repository in format owner/repo
 *   SOURCE_TAG - Git tag that was rolled back to
 *   GITHUB_SHA - Current commit SHA
 */

const { Octokit } = require("@octokit/rest")
const { calculateRollbackVersion } = require("./set-rollback-version")

async function createRollbackPR() {
	const token = process.env.GITHUB_TOKEN
	const repository = process.env.GITHUB_REPOSITORY
	const sourceTag = process.env.SOURCE_TAG
	const currentSha = process.env.GITHUB_SHA

	if (!token || !repository || !sourceTag || !currentSha) {
		console.error("Missing required environment variables")
		console.error("Required: GITHUB_TOKEN, GITHUB_REPOSITORY, SOURCE_TAG, GITHUB_SHA")
		process.exit(1)
	}

	const [owner, repo] = repository.split("/")
	const octokit = new Octokit({ auth: token })

	try {
		console.error("Creating rollback version PR...")
		console.error(`Repository: ${owner}/${repo}`)
		console.error(`Source: ${sourceTag}`)
		console.error("")

		// Get current version from main and calculate rollback version
		const { data: mainPackageFile } = await octokit.rest.repos.getContent({
			owner,
			repo,
			path: "src/package.json",
			ref: "main",
		})
		const mainVersion = JSON.parse(Buffer.from(mainPackageFile.content, "base64").toString()).version
		const rollbackVersion = calculateRollbackVersion(mainVersion)

		console.error(`Current version on main: ${mainVersion}`)
		console.error(`Calculated rollback version: ${rollbackVersion}`)
		console.error("")

		// Create branch
		const branchName = `rollback-to-${rollbackVersion}`
		console.error(`Creating branch: ${branchName}`)

		await octokit.rest.git.createRef({
			owner,
			repo,
			ref: `refs/heads/${branchName}`,
			sha: currentSha,
		})

		// Get CHANGELOG from main
		console.error("Fetching CHANGELOG from main...")

		const { data: mainChangelog } = await octokit.rest.repos.getContent({
			owner,
			repo,
			path: "CHANGELOG.md",
			ref: "main",
		})

		// Update package.json
		console.error("Updating package.json...")
		const packageJson = JSON.parse(Buffer.from(mainPackageFile.content, "base64").toString())
		packageJson.version = rollbackVersion

		await octokit.rest.repos.createOrUpdateFileContents({
			owner,
			repo,
			path: "src/package.json",
			message: `chore: update version to ${rollbackVersion}`,
			content: Buffer.from(JSON.stringify(packageJson, null, "\t") + "\n").toString("base64"),
			branch: branchName,
			sha: mainPackageFile.sha,
		})

		// Update CHANGELOG.md
		console.error("Updating CHANGELOG.md...")
		const changelogContent = Buffer.from(mainChangelog.content, "base64").toString()
		const today = new Date().toISOString().split("T")[0]
		const rollbackEntry = `## [v${rollbackVersion}] - ${today}\n\n🔄 **Rollback Release**: Restored stable functionality from \`${sourceTag}\`\n\n`
		const updatedChangelog = rollbackEntry + changelogContent

		await octokit.rest.repos.createOrUpdateFileContents({
			owner,
			repo,
			path: "CHANGELOG.md",
			message: `docs: add rollback entry to changelog`,
			content: Buffer.from(updatedChangelog).toString("base64"),
			branch: branchName,
			sha: mainChangelog.sha,
		})

		// Create PR
		console.error("Creating pull request...")
		const { data: pr } = await octokit.rest.pulls.create({
			owner,
			repo,
			title: `chore: rollback version to ${rollbackVersion}`,
			head: branchName,
			base: "main",
			body: `## Rollback Version Update

This PR updates the main branch to reflect the rollback version that was just published.

**Source:** \`${sourceTag}\`  
**Rollback Version:** \`${rollbackVersion}\`

### Changes
- Updated \`src/package.json\` version to \`${rollbackVersion}\`
- Added rollback entry to \`CHANGELOG.md\`

**Note:** This rollback was published to the marketplace. Merge this PR to keep main in sync with published versions.`,
		})

		console.error("")
		console.error(`✅ Created PR #${pr.number}: ${pr.html_url}`)
		console.error("")

		// Output for GitHub Actions
		console.log(`pr_number=${pr.number}`)
		console.log(`pr_url=${pr.html_url}`)
	} catch (error) {
		console.error(`❌ Error: ${error.message}`)
		if (error.response) {
			console.error("Response:", error.response.data)
		}
		process.exit(1)
	}
}

if (require.main === module) {
	createRollbackPR()
}

module.exports = { createRollbackPR }
