import fs from "fs"
import os from "os"
import path from "path"
import { localPathOrUriToPath, localPathToUri } from "../util/pathToUri"

// Want this outside of the git repository so we can change branches in tests
// Also ensure each Vitest worker gets an isolated test workspace to avoid
// concurrent test files deleting each other's fixtures.
const TEST_DIR_PATH = path.join(os.tmpdir(), `testWorkspaceDir-${process.env.VITEST_WORKER_ID ?? "0"}`)
export const TEST_DIR = localPathToUri(TEST_DIR_PATH) // URI

export function setUpTestDir() {
	if (fs.existsSync(TEST_DIR_PATH)) {
		fs.rmSync(TEST_DIR_PATH, {
			recursive: true,
			force: true,
			maxRetries: 5,
			retryDelay: 50,
		})
	}
	fs.mkdirSync(TEST_DIR_PATH)
}

export function tearDownTestDir() {
	if (fs.existsSync(TEST_DIR_PATH)) {
		fs.rmSync(TEST_DIR_PATH, {
			recursive: true,
			force: true,
			maxRetries: 5,
			retryDelay: 50,
		})
	}
}

/*
  accepts array of items in 3 formats, e.g.
  "index/" creates index directory
  "index/index.ts" creates an empty index/index.ts
  ["index/index.ts", "hello"] creates index/index.ts with contents "hello"
*/
export function addToTestDir(pathsOrUris: (string | [string, string])[]) {
	// Allow tests to use URIs or local paths
	const paths = pathsOrUris.map((val) => {
		if (Array.isArray(val)) {
			return [localPathOrUriToPath(val[0]), val[1]]
		} else {
			return localPathOrUriToPath(val)
		}
	})

	for (const p of paths) {
		const filepath = path.join(TEST_DIR_PATH, Array.isArray(p) ? p[0] : p)
		fs.mkdirSync(path.dirname(filepath), { recursive: true })

		if (Array.isArray(p)) {
			fs.writeFileSync(filepath, p[1])
		} else if (p.endsWith("/")) {
			fs.mkdirSync(filepath, { recursive: true })
		} else {
			fs.writeFileSync(filepath, "")
		}
	}
}
