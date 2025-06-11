import fs from "fs/promises"
import path from "path"
import { ClineRulesToggles } from "../../../shared/cline-rules"

/**
 * Get rule files content with toggle state filtering (matches Cline's getRuleFilesTotalContent)
 */
export async function getRuleFilesTotalContent(
	rulesFilePaths: string[],
	basePath: string,
	toggles: ClineRulesToggles,
): Promise<string> {
	const ruleFilesTotalContent = await Promise.all(
		rulesFilePaths.map(async (filePath) => {
			const ruleFilePath = path.resolve(basePath, filePath)
			const ruleFilePathRelative = path.relative(basePath, ruleFilePath)

			// Check if this rule is disabled in toggles
			if (ruleFilePath in toggles && toggles[ruleFilePath] === false) {
				return null
			}

			return `${ruleFilePathRelative}\n` + (await fs.readFile(ruleFilePath, "utf8")).trim()
		}),
	).then((contents) => contents.filter(Boolean).join("\n\n"))

	return ruleFilesTotalContent
}
