/**
 * Skill Service - manages skill installation, listing, and removal
 * Integrates with the skills.sh ecosystem (https://skills.sh)
 */

import fs from "fs/promises"
import * as path from "path"
import * as os from "os"
import matter from "gray-matter"
import simpleGit from "simple-git"
import { logs } from "../logs.js"

export type SkillScope = "project" | "global"

export interface SkillMeta {
	name: string
	description?: string
	scope: SkillScope
	dir: string
	skillFile: string
	source?: string
}

export interface InstallOptions {
	scope?: SkillScope
	force?: boolean
	cwd?: string
}

export interface ListOptions {
	scope?: SkillScope | "all"
	cwd?: string
}

export interface RemoveOptions {
	scope?: SkillScope
	cwd?: string
}

export interface InstallResult {
	installed: SkillMeta[]
	skipped: { name: string; reason: string }[]
	errors: { name: string; error: string }[]
}

/**
 * Normalize a skill name to a valid directory slug
 */
function toSkillId(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
}

/**
 * Get the skills directory for a given scope
 */
export function getSkillsDir(scope: SkillScope, cwd?: string): string {
	if (scope === "global") {
		return path.join(os.homedir(), ".kilocode", "skills")
	}
	return path.join(cwd || process.cwd(), ".kilocode", "skills")
}

/**
 * Ensure the skills directory exists
 */
async function ensureSkillsDir(scope: SkillScope, cwd?: string): Promise<string> {
	const dir = getSkillsDir(scope, cwd)
	await fs.mkdir(dir, { recursive: true })
	return dir
}

/**
 * Parse SKILL.md file and extract frontmatter
 */
async function parseSkillFile(skillFilePath: string): Promise<{ name: string; description?: string } | null> {
	try {
		const content = await fs.readFile(skillFilePath, "utf-8")
		const parsed = matter(content)

		const name = typeof parsed.data.name === "string" ? parsed.data.name.trim() : ""
		if (!name) {
			return null
		}

		const description = typeof parsed.data.description === "string" ? parsed.data.description.trim() : undefined

		return { name, description }
	} catch (error) {
		logs.warn(`Failed to parse skill file: ${skillFilePath}`, "SkillService", { error })
		return null
	}
}

/**
 * Find all SKILL.md files in a directory (up to a certain depth)
 */
async function findSkillFiles(rootDir: string, maxDepth: number = 4): Promise<string[]> {
	const skillFiles: string[] = []

	async function scan(dir: string, depth: number): Promise<void> {
		if (depth > maxDepth) return

		try {
			const entries = await fs.readdir(dir, { withFileTypes: true })

			for (const entry of entries) {
				const fullPath = path.join(dir, entry.name)

				if (entry.isFile() && entry.name === "SKILL.md") {
					skillFiles.push(fullPath)
				} else if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") {
					await scan(fullPath, depth + 1)
				}
			}
		} catch (error) {
			logs.debug(`Failed to scan directory: ${dir}`, "SkillService", { error })
		}
	}

	await scan(rootDir, 0)
	return skillFiles
}

/**
 * Copy a directory recursively, excluding certain patterns
 */
async function copyDir(src: string, dest: string, excludePatterns: string[] = [".git", "node_modules"]): Promise<void> {
	await fs.mkdir(dest, { recursive: true })

	const entries = await fs.readdir(src, { withFileTypes: true })

	for (const entry of entries) {
		if (excludePatterns.includes(entry.name)) continue

		const srcPath = path.join(src, entry.name)
		const destPath = path.join(dest, entry.name)

		if (entry.isDirectory()) {
			await copyDir(srcPath, destPath, excludePatterns)
		} else {
			await fs.copyFile(srcPath, destPath)
		}
	}
}

/**
 * Remove a directory recursively
 */
async function removeDir(dir: string): Promise<void> {
	await fs.rm(dir, { recursive: true, force: true })
}

/**
 * Parse a GitHub source string into owner and repo
 * Accepts: owner/repo, https://github.com/owner/repo, https://github.com/owner/repo.git
 */
function parseGitHubSource(source: string): { owner: string; repo: string } | null {
	// Handle full GitHub URLs
	const urlMatch = source.match(/(?:https?:\/\/)?(?:www\.)?github\.com\/([^\/]+)\/([^\/\.]+)(?:\.git)?/)
	if (urlMatch) {
		return { owner: urlMatch[1]!, repo: urlMatch[2]! }
	}

	// Handle owner/repo format
	const shortMatch = source.match(/^([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_-]+)$/)
	if (shortMatch) {
		return { owner: shortMatch[1]!, repo: shortMatch[2]! }
	}

	return null
}

/**
 * List installed skills
 */
export async function listSkills(options: ListOptions = {}): Promise<SkillMeta[]> {
	const { scope = "all", cwd } = options
	const skills: SkillMeta[] = []

	const scopes: SkillScope[] = scope === "all" ? ["project", "global"] : [scope]

	for (const s of scopes) {
		const skillsDir = getSkillsDir(s, cwd)

		try {
			const entries = await fs.readdir(skillsDir, { withFileTypes: true })

			for (const entry of entries) {
				if (!entry.isDirectory()) continue

				const skillDir = path.join(skillsDir, entry.name)
				const skillFile = path.join(skillDir, "SKILL.md")

				try {
					await fs.access(skillFile)
					const parsed = await parseSkillFile(skillFile)

					if (parsed) {
						skills.push({
							name: parsed.name,
							description: parsed.description,
							scope: s,
							dir: skillDir,
							skillFile,
						})
					}
				} catch {
					// No SKILL.md in this directory, skip
				}
			}
		} catch {
			// Directory doesn't exist, skip
		}
	}

	return skills
}

/**
 * Install skills from a GitHub repository
 */
export async function installFromSource(source: string, options: InstallOptions = {}): Promise<InstallResult> {
	const { scope = "project", force = false, cwd } = options

	const result: InstallResult = {
		installed: [],
		skipped: [],
		errors: [],
	}

	// Parse the source
	const parsed = parseGitHubSource(source)
	if (!parsed) {
		result.errors.push({
			name: source,
			error: `Invalid source format. Use owner/repo or https://github.com/owner/repo`,
		})
		return result
	}

	const { owner, repo } = parsed
	const repoUrl = `https://github.com/${owner}/${repo}.git`

	logs.info(`Installing skills from ${owner}/${repo}`, "SkillService")

	// Create temp directory
	const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "kilocode-skill-"))

	try {
		// Clone the repository
		const git = simpleGit()
		await git.clone(repoUrl, tmpDir, ["--depth", "1"])

		logs.debug(`Cloned repository to ${tmpDir}`, "SkillService")

		// Find all SKILL.md files
		const skillFiles = await findSkillFiles(tmpDir)

		if (skillFiles.length === 0) {
			result.errors.push({
				name: source,
				error: "No skills found in repository. Skills must contain a SKILL.md file.",
			})
			return result
		}

		logs.info(`Found ${skillFiles.length} skill(s) in repository`, "SkillService")

		// Ensure destination directory exists
		const destDir = await ensureSkillsDir(scope, cwd)

		// Install each skill
		for (const skillFile of skillFiles) {
			const skillDir = path.dirname(skillFile)
			const parsed = await parseSkillFile(skillFile)

			if (!parsed) {
				result.errors.push({
					name: path.basename(skillDir),
					error: "Invalid SKILL.md: missing required 'name' field in frontmatter",
				})
				continue
			}

			const skillId = toSkillId(parsed.name)
			const targetDir = path.join(destDir, skillId)

			// Check if already exists
			try {
				await fs.access(targetDir)
				if (!force) {
					result.skipped.push({
						name: parsed.name,
						reason: "Already installed. Use --force to overwrite.",
					})
					continue
				}
				// Remove existing if force
				await removeDir(targetDir)
			} catch {
				// Doesn't exist, good to install
			}

			// Copy skill directory
			await copyDir(skillDir, targetDir)

			result.installed.push({
				name: parsed.name,
				description: parsed.description,
				scope,
				dir: targetDir,
				skillFile: path.join(targetDir, "SKILL.md"),
				source: `${owner}/${repo}`,
			})

			logs.info(`Installed skill: ${parsed.name}`, "SkillService")
		}
	} finally {
		// Clean up temp directory
		await removeDir(tmpDir)
	}

	return result
}

/**
 * Remove an installed skill
 */
export async function removeSkill(nameOrId: string, options: RemoveOptions = {}): Promise<{ removed: boolean; skill?: SkillMeta; error?: string }> {
	const { scope, cwd } = options

	// Normalize input
	const searchId = toSkillId(nameOrId)

	// Determine which scopes to search
	const scopes: SkillScope[] = scope ? [scope] : ["project", "global"]

	for (const s of scopes) {
		const skillsDir = getSkillsDir(s, cwd)

		try {
			const entries = await fs.readdir(skillsDir, { withFileTypes: true })

			for (const entry of entries) {
				if (!entry.isDirectory()) continue

				const skillDir = path.join(skillsDir, entry.name)
				const skillFile = path.join(skillDir, "SKILL.md")

				try {
					await fs.access(skillFile)
					const parsed = await parseSkillFile(skillFile)

					// Match by directory name or skill name
					const dirId = toSkillId(entry.name)
					const nameId = parsed ? toSkillId(parsed.name) : ""

					if (dirId === searchId || nameId === searchId) {
						const skill: SkillMeta = {
							name: parsed?.name || entry.name,
							description: parsed?.description,
							scope: s,
							dir: skillDir,
							skillFile,
						}

						await removeDir(skillDir)
						logs.info(`Removed skill: ${skill.name}`, "SkillService")

						return { removed: true, skill }
					}
				} catch {
					// No SKILL.md, skip
				}
			}
		} catch {
			// Directory doesn't exist
		}
	}

	return { removed: false, error: `Skill "${nameOrId}" not found` }
}
