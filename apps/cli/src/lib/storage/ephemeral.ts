import path from "path"
import os from "os"
import fs from "fs"

export async function createEphemeralStorageDir(): Promise<string> {
	const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
	const tmpDir = path.join(os.tmpdir(), `roo-cli-${uniqueId}`)
	await fs.promises.mkdir(tmpDir, { recursive: true })
	return tmpDir
}
