import { LRUCache } from "lru-cache"
import { CodeContext } from "./ContextGatherer"

export class AutocompleteCache {
	private lru: LRUCache<string, string[]>
	private maxLinesToConsiderInKey = 5

	constructor() {
		this.lru = new LRUCache<string, string[]>({
			max: 50,
			ttl: 1000 * 60 * 60 * 24, // Cache for 24 hours
		})
	}

	private _get(key: string): string[] | undefined {
		return this.lru.get(key)
	}

	private _set(key: string, completions: string[]) {
		this.lru.set(key, completions)
	}

	private getKeyFromContext(context: CodeContext) {
		const { precedingLines, followingLines } = context
		const precedingContext = precedingLines.slice(-this.maxLinesToConsiderInKey).join("\n")
		const followingContext = followingLines.slice(0, this.maxLinesToConsiderInKey).join("\n")
		return `${precedingContext}|||${followingContext}`
	}

	public getByContext(context: CodeContext) {
		const key = this.getKeyFromContext(context)
		return this._get(key)
	}

	public setByContext(context: CodeContext, completions: string[]) {
		const key = this.getKeyFromContext(context)
		this._set(key, completions)
	}
}
