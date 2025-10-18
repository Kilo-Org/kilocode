export declare class LlamaTokenizer {
	vocabById: string[]
	vocabByString: Map<string, number>
	merges: Map<string, number>
	constructor(vocab_base64?: string, merges_binary?: string)
	public encode(
		prompt: string,
		add_bos_token?: boolean,
		add_preceding_space?: boolean,
		log_performance?: boolean,
	): number[]
	public decode(tokenIds: number[], add_bos_token?: boolean, add_preceding_space?: boolean): string
	runTests(tests?: (tokenizer: LlamaTokenizer) => boolean): void
}
export declare const llamaTokenizer: LlamaTokenizer
