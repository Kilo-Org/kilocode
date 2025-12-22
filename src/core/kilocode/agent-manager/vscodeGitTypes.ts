// kilocode_change - new file: Type definitions for VS Code Git Extension API
/**
 * VS Code Git Extension API types
 * Based on: https://github.com/microsoft/vscode/blob/main/extensions/git/src/api/git.d.ts
 */

import type { Uri } from "vscode"

/**
 * Reference type enum matching VS Code's RefType
 */
export enum RefType {
	Head = 0,
	RemoteHead = 1,
	Tag = 2,
}

/**
 * Git reference (branch, tag, remote)
 */
export interface Ref {
	readonly type: RefType
	readonly name?: string
	readonly commit?: string
	readonly remote?: string
}

/**
 * Git branch with tracking info
 */
export interface Branch extends Ref {
	readonly upstream?: { remote: string; name: string }
	readonly ahead?: number
	readonly behind?: number
}

/**
 * Repository state containing refs and HEAD
 */
export interface RepositoryState {
	readonly HEAD: Branch | undefined
	readonly refs: Ref[]
	readonly remotes: { name: string; fetchUrl?: string; pushUrl?: string }[]
}

/**
 * Query parameters for getBranches
 */
export interface BranchQuery {
	readonly pattern?: string
	readonly count?: number
	readonly contains?: string
	readonly remote?: boolean
	readonly sort?: "alphabetically" | "committerdate"
}

/**
 * Git repository interface
 */
export interface Repository {
	readonly rootUri: Uri
	readonly state: RepositoryState
	getBranches(query: BranchQuery): Promise<Ref[]>
}

/**
 * Git extension API v1
 */
export interface GitAPI {
	readonly repositories: Repository[]
}
