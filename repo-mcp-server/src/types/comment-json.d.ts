declare module "comment-json" {
	export function parse(text: string, reviver?: ((key: any, value: any) => any) | null, tolerant?: boolean): any

	export function stringify(
		value: any,
		replacer?: ((key: string, value: any) => any) | (string | number)[] | null,
		space?: string | number | null,
	): string
}
