import * as fs from "fs"
import * as os from "os"
import * as path from "path"

const CONTINUE_GLOBAL_DIR = (() => {
	const configPath = process.env.CONTINUE_GLOBAL_DIR
	if (configPath) {
		// Convert relative path to absolute paths based on current working directory
		return path.isAbsolute(configPath) ? configPath : path.resolve(process.cwd(), configPath)
	}
	return path.join(os.homedir(), ".continue")
})()

function getContinueGlobalPath(): string {
	// This is ~/.continue on mac/linux
	const continuePath = CONTINUE_GLOBAL_DIR
	if (!fs.existsSync(continuePath)) {
		fs.mkdirSync(continuePath)
	}
	return continuePath
}

function getIndexFolderPath(): string {
	const indexPath = path.join(getContinueGlobalPath(), "index")
	if (!fs.existsSync(indexPath)) {
		fs.mkdirSync(indexPath)
	}
	return indexPath
}

export function getConfigJsonPath(): string {
	const p = path.join(getContinueGlobalPath(), "config.json")
	return p
}
