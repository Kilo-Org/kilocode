import { MinimalConfigProvider } from "../autocomplete/MinimalConfig"
import { FileSystemIde } from "../util/filesystem"

import { TEST_DIR } from "./testDir"

export const testIde = new FileSystemIde(TEST_DIR)

// For autocomplete/nextEdit tests, use MinimalConfigProvider
export const testMinimalConfigProvider = new MinimalConfigProvider()
