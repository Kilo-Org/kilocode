const withMarkdoc = require("@markdoc/next.js")
const previousDocsRedirects = require("./previous-docs-redirects")

module.exports = withMarkdoc(/* config: https://markdoc.io/docs/nextjs#options */)({
	pageExtensions: ["js", "jsx", "ts", "tsx", "md", "mdoc"],
	basePath: "/docs",
	turbopack: {},
	experimental: {
		instrumentationHook: true,
	},
	async redirects() {
		return [...previousDocsRedirects]
	},
	async rewrites() {
		return {
			beforeFiles: [
				{
					// Rewrite /docs/llms.txt to the API endpoint (internal to basePath)
					source: "/llms.txt",
					destination: "/api/llms.txt",
				},
			],
		}
	},
})
