/**
 * TabGroupsAPI class for VSCode API
 */

import { EventEmitter } from "../classes/EventEmitter.js"
import type { Uri } from "../classes/Uri.js"
import type { Disposable } from "../interfaces/workspace.js"

/**
 * Tab interface representing an open tab
 */
export interface Tab {
	input: TabInputText | unknown
	label: string
	isActive: boolean
	isDirty: boolean
}

/**
 * Tab input for text files
 */
export interface TabInputText {
	uri: Uri
}

/**
 * Tab group interface
 */
export interface TabGroup {
	tabs: Tab[]
}

/**
 * Tab groups API mock for CLI mode
 */
export class TabGroupsAPI {
	private _onDidChangeTabs = new EventEmitter<void>()
	private _tabGroups: TabGroup[] = []

	get all(): TabGroup[] {
		return this._tabGroups
	}

	onDidChangeTabs(listener: () => void): Disposable {
		return this._onDidChangeTabs.event(listener)
	}

	async close(tab: Tab): Promise<boolean> {
		// Find and remove the tab from all groups
		for (const group of this._tabGroups) {
			const index = group.tabs.indexOf(tab)
			if (index !== -1) {
				group.tabs.splice(index, 1)
				this._onDidChangeTabs.fire()
				return true
			}
		}
		return false
	}

	// Internal method to simulate tab changes for CLI
	_simulateTabChange(): void {
		this._onDidChangeTabs.fire()
	}

	dispose(): void {
		this._onDidChangeTabs.dispose()
	}
}
