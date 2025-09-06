// Copyright 2009-2025 Weibo, Inc.
// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

import {
	ExtensionIdentifier,
	IExtensionDescription,
	TargetPlatform,
} from "../deps/vscode/vs/platform/extensions/common/extensions.js"
import { URI } from "../deps/vscode/vs/base/common/uri.js"
import { ExtHostContext } from "../deps/vscode/vs/workbench/api/common/extHost.protocol.js"
import { IRPCProtocol } from "../deps/vscode/vs/workbench/services/extensions/common/proxyIdentifier.js"
import * as fs from "fs"
import * as path from "path"

export class ExtensionManager {
	private extensionDescriptions: Map<string, IExtensionDescription> = new Map()

	/**
	 * Parse extension description information
	 * @param extensionPath Extension path
	 * @returns Extension description object
	 */
	private parseExtensionDescription(extensionPath: string): IExtensionDescription {
		const packageJsonPath = path.join(extensionPath, "extension.package.json")
		const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"))

		return {
			identifier: new ExtensionIdentifier(packageJson.name),
			name: packageJson.name,
			displayName: packageJson.displayName,
			description: packageJson.description,
			version: packageJson.version,
			publisher: packageJson.publisher,
			main: "./extension.cjs",
			activationEvents: packageJson.activationEvents || ["onStartupFinished"],
			extensionLocation: URI.file(path.resolve(extensionPath)),
			targetPlatform: TargetPlatform.UNIVERSAL,
			isBuiltin: false,
			isUserBuiltin: false,
			isUnderDevelopment: false,
			engines: packageJson.engines || { vscode: "^1.0.0" },
			preRelease: false,
			capabilities: {},
			extensionDependencies: packageJson.extensionDependencies || [],
		}
	}

	/**
	 * Get all parsed extension descriptions
	 * @returns Extension description array
	 */
	public getAllExtensionDescriptions(): IExtensionDescription[] {
		return Array.from(this.extensionDescriptions.values())
	}

	/**
	 * Get description information for specified extension
	 * @param extensionId Extension ID
	 * @returns Extension description object, or undefined if not exists
	 */
	public getExtensionDescription(extensionId: string): IExtensionDescription | undefined {
		return this.extensionDescriptions.get(extensionId)
	}

	/**
	 * Register an extension
	 * @param extensionPath Extension path
	 * @returns Extension description object
	 */
	public registerExtension(extensionPath: string): IExtensionDescription {
		const extensionDescription = this.parseExtensionDescription(extensionPath)
		this.extensionDescriptions.set(extensionDescription.identifier.value, extensionDescription)
		return extensionDescription
	}

	/**
	 * Activate a registered extension
	 * @param extensionId Extension ID
	 * @param protocol RPC protocol
	 */
	public async activateExtension(extensionId: string, protocol: IRPCProtocol): Promise<void> {
		const extensionDescription = this.extensionDescriptions.get(extensionId)
		if (!extensionDescription) {
			throw new Error(`Extension ${extensionId} is not registered`)
		}

		try {
			const extensionService = protocol.getProxy(ExtHostContext.ExtHostExtensionService)
			await extensionService.$activate(extensionDescription.identifier, {
				startup: true,
				extensionId: extensionDescription.identifier,
				activationEvent: "api",
			})
		} catch (error) {
			console.error(`Failed to activate extension ${extensionId}:`, error)
			throw error
		}
	}
}
