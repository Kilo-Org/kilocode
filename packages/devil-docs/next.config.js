const withMarkdoc = require("@markdoc/next.js")
const previousDocsRedirects = require("./previous-docs-redirects")

module.exports = withMarkdoc(/* config: https://markdoc.io/docs/nextjs#options */)({
  pageExtensions: ["js", "jsx", "ts", "tsx", "md", "mdoc"],
  basePath: "/docs",
  turbopack: {},
  skipTrailingSlashRedirect: true, // PostHog sends trailing-slash requests that Next.js would otherwise 308-redirect
  async redirects() {
    return [
      {
        source: "/",
        destination: "/docs",
        basePath: false,
        permanent: true,
      },
      {
        source: "/kiloclaw",
        destination: "/kiloclaw/overview",
        permanent: false,
      },
      ...previousDocsRedirects,
    ]
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
      afterFiles: [
        {
          source: "/ingest/static/:path*",
          destination: "https://us-assets.i.posthog.com/static/:path*",
          basePath: false,
        },
        { source: "/ingest/decide", destination: "https://us.i.posthog.com/decide", basePath: false },
        { source: "/ingest/:path*", destination: "https://us.i.posthog.com/:path*", basePath: false }, // catch-all must be last
      ],
    }
  },
})
