import { config } from "@roo-code/config-eslint/base"

export default [
	...config,
	{
		rules: {
			// "@typescript-eslint/no-explicit-any": "off",
		},
	},
	{
		ignores: ["dist/*"],
	},
]
