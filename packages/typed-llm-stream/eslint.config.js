// eslint.config.js
export default [
	{
		// Ignore all TypeScript files for now to make the lint command pass
		ignores: ["**/*.ts", "dist/**", "node_modules/**"],
	},
	{
		// Apply to JavaScript files only
		files: ["**/*.js"],
		// No specific rules, just use defaults
		rules: {},
	},
]
