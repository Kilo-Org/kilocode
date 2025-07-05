// kilocode_change - new file
import ignore, { Ignore } from "ignore"
import { normalize } from "path"

const lockFiles: string[] = [
	// --- JavaScript / Node.js ---
	"package-lock.json",
	"npm-shrinkwrap.json",
	"yarn.lock",
	"pnpm-lock.yaml",
	"pnpm-workspace.yaml", // PNPM workspace lock
	"bun.lockb",
	".yarnrc.yml", // Yarn v2+ config
	".pnp.js", // Yarn PnP loader
	".pnp.cjs", // Yarn PnP loader
	"jspm.lock", // JSPM

	// --- Python ---
	"Pipfile.lock",
	"poetry.lock",
	"pdm.lock",
	".pdm-lock.toml",
	"conda-lock.yml",
	"pylock.toml",

	// --- Ruby ---
	"Gemfile.lock",
	".bundle/config", // Bundler configuration

	// --- PHP ---
	"composer.lock",

	// --- Java / JVM ---
	"gradle.lockfile",
	"lockfile.json", // Commonly used by Maven plugins
	"dependency-lock.json", // Alternative Maven lock
	"dependency-reduced-pom.xml", // Maven Shade Plugin
	"coursier.lock", // Coursier/SBT

	// --- Scala ---
	"build.sbt.lock", // SBT lock files

	// --- .NET ---
	"packages.lock.json",
	"paket.lock", // Paket package manager
	"project.assets.json", // MSBuild restore artifacts

	// --- Rust ---
	"Cargo.lock",

	// --- Go ---
	"go.sum",
	"Gopkg.lock", // For the older 'dep' tool
	"glide.lock", // Glide (legacy)
	"vendor/vendor.json", // govendor (legacy)

	// --- Zig ---
	"build.zig.zon.lock", // Zig package manager

	// --- OCaml ---
	"dune.lock", // Dune lock file
	"opam.lock", // OPAM lock file

	// --- Kotlin ---
	"kotlin-js-store", // Kotlin/JS dependencies (directory)

	// --- Swift / iOS ---
	"Package.resolved", // Swift Package Manager
	"Podfile.lock", // CocoaPods
	"Cartfile.resolved", // Carthage

	// --- Dart / Flutter ---
	"pubspec.lock", // Dart / Flutter

	// --- Elixir / Erlang ---
	"mix.lock", // Elixir
	"rebar.lock", // Erlang (Rebar3)

	// --- Haskell ---
	"stack.yaml.lock", // Haskell (Stack)
	"cabal.project.freeze", // Haskell (Cabal)

	// --- Elm ---
	"elm-stuff/exact-dependencies.json", // Elm dependencies

	// --- Crystal ---
	"shard.lock", // Crystal Shards

	// --- Julia ---
	"Manifest.toml", // Julia Pkg
	"JuliaManifest.toml", // Julia alternative

	// --- R ---
	"renv.lock", // R renv
	"packrat.lock", // R packrat

	// --- Nim ---
	"nimble.lock", // Nim package manager

	// --- D ---
	"dub.selections.json", // D DUB package manager

	// --- Lua ---
	"rocks.lock", // LuaRocks

	// --- Perl ---
	"carton.lock", // Perl (Carton)
	"cpanfile.snapshot", // Perl (cpanminus)

	// --- C/C++ ---
	"conan.lock", // C/C++ (Conan)
	"vcpkg-lock.json", // vcpkg

	// --- Infrastructure as Code ---
	".terraform.lock.hcl", // Terraform provider lock
	"Berksfile.lock", // Chef
	"Puppetfile.lock", // Puppet

	// --- Nix ---
	"flake.lock", // Nix Flakes

	// --- Deno ---
	"deno.lock", // Deno lock file

	// --- DevContainers ---
	"devcontainer.lock.json", // DevContainer CLI
]

const createLockFileIgnoreInstance = (): Ignore => {
	const ignoreInstance = ignore()

	// Add lock file patterns - use glob patterns to match files in any directory
	const lockFilePatterns = lockFiles.map((file) => `**/${file}`)
	ignoreInstance.add(lockFilePatterns)

	// Add directory patterns - use ** to match these directories anywhere in the path
	const directoryPatterns = [
		"**/kotlin-js-store",
		"**/kotlin-js-store/**",
		"**/elm-stuff",
		"**/elm-stuff/**",
		"**/.yarn/cache/**",
		"**/.yarn/unplugged/**",
		"**/.yarn/build-state.yml",
		"**/.yarn/install-state.gz",
	]
	ignoreInstance.add(directoryPatterns)

	return ignoreInstance
}

const lockFileIgnoreInstance = createLockFileIgnoreInstance() // Singleton ignore instance

/**
 * Determines if a file should be excluded from git diffs based on lock file patterns.
 * This function specifically handles package manager lock files and build artifacts
 * that typically shouldn't be included in commit message generation.
 *
 * @param filename - The filename to check (can be a full path or just filename)
 * @returns boolean - true if the file should be excluded from git diffs
 */
export function shouldExcludeLockFile(filePath: string): boolean {
	const normalizedPath = normalize(filePath)
	return lockFileIgnoreInstance.ignores(normalizedPath)
}
