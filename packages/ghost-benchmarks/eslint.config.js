import { config } from "@roo-code/config-eslint/base"

export default [
	...config,
	{
		ignores: [
			"dist/**",
			"**/__test_cases__/**",
			"**/__test_cases_autocomplete__/**",
			"**/__test_cases_migrated__/**",
		],
	},
]
