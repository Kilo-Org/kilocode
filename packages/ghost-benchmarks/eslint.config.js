import { config } from "@roo-code/config-eslint/base"

export default [
	...config,
	{
		ignores: ["dist/**", "**/test-cases/**"],
	},
]
