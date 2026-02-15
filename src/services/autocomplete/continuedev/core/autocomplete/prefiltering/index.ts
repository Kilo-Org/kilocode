import ignore from "ignore"
import { getConfigJsonPath } from "../../util/paths"
import { findUriInDirs } from "../../util/uri"
import { HelperVars } from "../util/HelperVars"

async function isDisabledForFile(
	currentFilepath: string,
	disableInFiles: string[] | undefined,
	workspaceDirs: string[],
) {
	if (disableInFiles) {
		// Relative path needed for `ignore`
		const { relativePathOrBasename } = findUriInDirs(currentFilepath, workspaceDirs)

		const pattern = ignore().add(disableInFiles)
		if (pattern.ignores(relativePathOrBasename)) {
			return true
		}
	}
	return false
}

export async function shouldPrefilter(helper: HelperVars, workspaceDirs: string[]): Promise<boolean> {
	// Allow disabling autocomplete from config.json
	if (helper.options.disable) {
		return true
	}

	// Check whether we're in the continue config.json file
	if (helper.filepath === getConfigJsonPath()) {
		return true
	}

	// Check whether autocomplete is disabled for this file
	const disableInFiles = [
		...(helper.options.disableInFiles ?? []),
		"*.prompt",
		// "some-example-ignored-file", //MINIMAL_REPO - was configurable
	]
	if (await isDisabledForFile(helper.filepath, disableInFiles, workspaceDirs)) {
		return true
	}

	// Don't offer completions when we have no information (untitled file and no file contents)
	if (helper.filepath.includes("Untitled") && helper.fileContents.trim() === "") {
		return true
	}

	// if (
	//   helper.options.transform &&
	//   (await shouldLanguageSpecificPrefilter(helper))
	// ) {
	//   return true;
	// }

	return false
}
