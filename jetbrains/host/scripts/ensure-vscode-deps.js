#!/usr/bin/env node

/**
 * Ensure JetBrains host has a local copy of VSCode sources needed for build.
 * This avoids running JetBrains plugin dependency checks (Java/Gradle).
 */

import fs from "fs"
import path from "path"
import { spawnSync } from "child_process"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const hostDir = path.resolve(__dirname, "..")
const projectRoot = path.resolve(hostDir, "..", "..")

const vscodeDir = path.join(projectRoot, "deps", "vscode")
const sourceDir = path.join(vscodeDir, "src")
const targetDir = path.join(hostDir, "deps", "vscode")

const expectedSourceFile = path.join(sourceDir, "vs", "base", "common", "uri.ts")
const patchMarkerSource = path.join(
	sourceDir,
	"vs",
	"workbench",
	"services",
	"extensions",
	"common",
	"fileRPCProtocolLogger.ts",
)
const patchMarkerTarget = path.join(
	targetDir,
	"vs",
	"workbench",
	"services",
	"extensions",
	"common",
	"fileRPCProtocolLogger.ts",
)
const patchFile = path.join(projectRoot, "deps", "patches", "vscode", "jetbrains.patch")

function fail(message) {
	console.error(message)
	process.exit(1)
}

if (!fs.existsSync(sourceDir) || !fs.existsSync(expectedSourceFile)) {
	fail(
		[
			"VSCode submodule is missing or incomplete.",
			"Run: git submodule update --init --recursive deps/vscode",
		].join("\n"),
	)
}

if (!fs.existsSync(patchMarkerSource)) {
	const status = spawnSync("git", ["status", "--porcelain"], {
		cwd: vscodeDir,
		encoding: "utf8",
	})
	if (status.status !== 0) {
		fail("Failed to check VSCode submodule status. Ensure git is available.")
	}

	if ((status.stdout || "").trim().length > 0) {
		fail(
			[
				"VSCode submodule has local changes. Cannot apply JetBrains patch automatically.",
				"Stash or reset submodule changes, then run:",
				"  pnpm run deps:patch",
			].join("\n"),
		)
	}

	const apply = spawnSync("git", ["apply", patchFile], {
		cwd: vscodeDir,
		stdio: "inherit",
	})
	if (apply.status !== 0) {
		fail("Failed to apply JetBrains patch to VSCode submodule.")
	}

	if (!fs.existsSync(patchMarkerSource)) {
		fail("JetBrains patch did not apply cleanly to the VSCode submodule.")
	}
}

if (fs.existsSync(patchMarkerTarget)) {
	process.exit(0)
}

fs.rmSync(targetDir, { recursive: true, force: true })
fs.mkdirSync(targetDir, { recursive: true })
fs.cpSync(sourceDir, targetDir, { recursive: true })

if (!fs.existsSync(patchMarkerTarget)) {
	fail("Failed to copy VSCode sources into jetbrains/host/deps/vscode.")
}
