// Comprehensive set of generated/vendor/build directories for diff filtering.
// Excludes ambiguous entries like "bin" (could be project scripts) or
// "desktop" (could be a product dir). Sourced from github/gitignore templates,
// toptal/gitignore, and common patterns across all major ecosystems.
//
// Used by FileIgnore.generated() to classify paths in worktree diffs.
// When a path segment matches an entry here, the file is treated as generated
// and excluded from full diff content (stats only).

export const GENERATED_FOLDERS = new Set([
  // -- Package managers / dependencies --
  "node_modules", // Node.js (npm, yarn, pnpm)
  "bower_components", // Bower
  "jspm_packages", // jspm
  "web_modules", // Snowpack
  ".pnpm-store", // pnpm global store
  ".npm", // npm cache
  ".yarn", // Yarn PnP / v3+
  "vendor", // PHP Composer, Go, Ruby bundler
  ".bundle", // Ruby Bundler
  "Pods", // CocoaPods (iOS/macOS)
  "Carthage", // Carthage (iOS/macOS)
  ".pixi", // Python pixi
  "__pypackages__", // PEP 582

  // -- Build output --
  "dist", // Generic build output
  "build", // Generic build output
  "out", // Generic build output / Go / IntelliJ
  ".next", // Next.js
  ".nuxt", // Nuxt.js
  ".output", // Nuxt 3 / Nitro
  ".svelte-kit", // SvelteKit
  ".docusaurus", // Docusaurus
  ".vitepress", // VitePress
  ".vite", // Vite
  "target", // Rust / Java Maven / Python PyBuilder
  "obj", // .NET / C#
  "artifacts", // .NET
  ".build", // Swift Package Manager
  "DerivedData", // Xcode
  "Intermediate", // Unreal Engine
  "dist-ssr", // Vite SSR
  "release", // Electron / generic release builds
  "nbbuild", // NetBeans
  "nbdist", // NetBeans
  ".nb-gradle", // NetBeans Gradle

  // -- Caches --
  ".turbo", // Turborepo
  ".cache", // Generic / Parcel / Vuepress
  ".parcel-cache", // Parcel v2
  ".eslintcache", // ESLint (file, but can be dir)
  ".stylelintcache", // Stylelint
  ".ruff_cache", // Python Ruff linter
  ".fusebox", // FuseBox bundler
  ".dynamodb", // DynamoDB Local

  // -- Python --
  "__pycache__", // Python bytecode
  ".pytest_cache", // pytest
  "mypy_cache", // mypy
  ".mypy_cache", // mypy (alternate)
  ".pytype", // pytype
  ".pyre", // pyre
  ".tox", // tox
  ".nox", // nox
  ".eggs", // setuptools
  ".hypothesis", // Hypothesis testing
  ".pybuilder", // PyBuilder
  ".pdm-build", // PDM
  "htmlcov", // coverage HTML reports
  ".nyc_output", // nyc (also Node)
  ".ipynb_checkpoints", // Jupyter Notebook
  "develop-eggs", // setuptools
  "sdist", // source distributions
  "wheels", // built wheels

  // -- Java / Kotlin / Android --
  ".gradle", // Gradle
  ".m2", // Maven local repo
  ".mvn", // Maven wrapper
  ".externalNativeBuild", // Android Studio
  "captures", // Android Studio
  ".navigation", // Android Studio
  ".kobalt", // Kobalt
  "kobaltBuild", // Kobalt

  // -- .NET / C# --
  ".vs", // Visual Studio
  "BundleArtifacts", // Windows Store

  // -- Ruby --
  ".sass-cache", // Sass/SCSS

  // -- VCS --
  ".git", // Git
  ".svn", // Subversion
  ".hg", // Mercurial

  // -- IDE / Editor --
  // NOTE: .vscode and .idea are intentionally excluded — many repos commit
  // settings.json, extensions.json, or run configs. Hiding those from diffs
  // would be surprising. They remain in FileIgnore.FOLDERS for file-search.
  ".idea_modules", // IntelliJ (generated, not config)
  ".history", // Local history
  ".settings", // Eclipse
  ".metadata", // Eclipse
  ".recommenders", // Eclipse

  // -- Terraform / IaC --
  ".terraform", // Terraform

  // -- Serverless / Cloud --
  ".serverless", // Serverless framework
  ".firebase", // Firebase
  ".wrangler", // Cloudflare Wrangler

  // -- Misc tooling --
  ".sst", // SST (Serverless Stack)
  ".tmp", // Generic temp
  ".temp", // Generic temp
  ".grunt", // Grunt
  ".meteor", // Meteor.js local
  "coverage", // Test coverage (many tools)
  "logs", // Log directories
  ".angular", // Angular cache

  // -- OS --
  "$RECYCLE.BIN", // Windows
])
