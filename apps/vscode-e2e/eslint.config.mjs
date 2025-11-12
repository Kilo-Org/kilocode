import { config } from "@roo-code/config-eslint/base"

/** @type {import("eslint").Linter.Config} */
export default [
	...config,
	{
		files: ["**/*.d.ts"],
		rules: {
			"no-var": "off",
		},
	},
]
