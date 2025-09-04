// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

// tsup.config.ts
import { defineConfig } from "tsup"

import { dependencies } from "./package.json"

export default defineConfig({
	entry: ["src/extension.ts"], // Your entry file
	format: ["esm"], // Output format, e.g., ES Module and CommonJS
	minify: true, // Minify code
	clean: true, // Clean output directory
	splitting: false,
	platform: "node", // Target platform, e.g., Node.js
	target: "node18", // Target environment, e.g., latest ECMAScript standard
	skipNodeModulesBundle: false, // Don't bundle dependencies in node_modules
	// noExternal: Object.keys(dependencies),
	// external:[/^@vscode\/.*$/], // Don't bundle vscode-related dependencies
	dts: false, // Don't generate type declaration files, as we usually handle type declarations separately
})
