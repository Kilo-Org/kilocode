/**
 * Package
 */

import { publisher, name, version } from "../package.json"

// These ENV variables can be defined by ESBuild when building the extension
// in order to override the values in package.json. This allows us to build
// different extension variants with the same package.json file.
// The build process still needs to emit a modified package.json for consumption
// by VSCode, but that build artifact is not used during the transpile step of
// the build, so we still need this override mechanism.
export const Package = {
	publisher,
	name: process.env.PKG_NAME || name,
	version: process.env.PKG_VERSION || version,
	// buildNumber: process.env.PKG_BUILD_NUMBER || buildNumber, // 移除此行，buildNumber将由webview-ui直接管理
	outputChannel: process.env.PKG_OUTPUT_CHANNEL || "Kilo-Code",
	sha: process.env.PKG_SHA,
} as const
