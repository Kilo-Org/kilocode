# Private profile-cutover build

The private build flag isolates artifacts from the publish workflow. Private and channel builds both use `kilo` and require explicit consent to convert a v1 database. A version probe does not open a profile.

From `packages/kilo-cli`, with workspace dependencies installed:

```sh
T=$(mktemp -d)
KILO_INTERNAL_PROFILE_CUTOVER_BUILD=0 bun run build --single --skip-install --skip-web-ui --outdir="$T/ordinary"
KILO_INTERNAL_PROFILE_CUTOVER_BUILD=1 bun run build --single --skip-install --skip-web-ui --outdir="$T/pilot"
for variant in ordinary pilot; do
  binary=$(find "$T/$variant" -type f \( -name kilo -o -name kilo.exe \))
  KILO_V2_TEST_BINARY="$binary" bun test test/migration-pilot-build.test.ts
done
```

This builds locally without publishing. The test runs the bundled executable through `script/dev-isolated.ts` with a fresh home, XDG roots and a generated SQLite session. It checks the profile used by the very command that prompted, then checks a fresh process; checking only the next launch misses stale `Global.Path` values captured during conversion. Run it on a supported local filesystem to exercise publication.

To build the matched private VSIX locally from the repo root:

```sh
KILO_INTERNAL_PROFILE_CUTOVER_BUILD=1 bun run --cwd packages/kilo-cli build --single --skip-install --skip-web-ui
KILO_INTERNAL_PROFILE_CUTOVER_BUILD=1 bun run --cwd packages/kilo-vscode package
```

This uses `.cache/pilot` in the CLI package, checks the private CLI manifest and executable SHA-256, and builds the private extension under `packages/kilo-vscode/.kilo-dev/pilot/`. The installable archive is in that directory's `out/`, not in the public publisher's input. Use only an isolated VS Code installation/profile when rehearsing it.
