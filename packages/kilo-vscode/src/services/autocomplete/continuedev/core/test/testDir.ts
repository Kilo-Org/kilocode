import fs from "fs"
import os from "os"
import path from "path"
import { localPathToUri } from "../util/pathToUri"

// Want this outside of the git repository so we can change branches in tests
const TEST_DIR_PATH = path.join(os.tmpdir(), "testWorkspaceDir")
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
