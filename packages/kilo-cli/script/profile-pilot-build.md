# Private profile-cutover build

`KILO_INTERNAL_PROFILE_CUTOVER_BUILD=1` selects the CLI build that can run the [profile cutover](../../../migration-tracking/technical-notes/profile-cutover.md). It enables the consent gate, not consent itself. The binary still uses `kilo2` until it verifies a completed cutover. The usual build always uses `kilo2` and refuses migration apply/recover, even if either pilot variable is set at launch. Running from source instead requires `KILO_INTERNAL_PROFILE_CUTOVER=1` at launch.

From `packages/kilo-cli`, with workspace dependencies installed:

```sh
T=$(mktemp -d)
KILO_INTERNAL_PROFILE_CUTOVER_BUILD=0 bun run build --single --skip-install --skip-web-ui --outdir="$T/ordinary"
KILO_INTERNAL_PROFILE_CUTOVER_BUILD=1 bun run build --single --skip-install --skip-web-ui --outdir="$T/pilot"
for variant in ordinary pilot; do
  binary=$(find "$T/$variant" -type f \( -name kilo2 -o -name kilo2.exe \))
  pilot=0; if [ "$variant" = pilot ]; then pilot=1; fi
  KILO_V2_TEST_PILOT=$pilot KILO_V2_TEST_BINARY="$binary" bun test test/migration-pilot-build.test.ts
done
```

This builds locally without publishing. The test runs the bundled executable through `script/dev-isolated.ts` with a fresh home, XDG roots and a generated SQLite session. It checks the profile used by the very command that prompted, then checks a fresh process; checking only the next launch misses stale `Global.Path` values captured during conversion. Run it on a supported local filesystem to exercise publication.

To build the matched private VSIX locally from the repo root:

```sh
KILO_INTERNAL_PROFILE_CUTOVER_BUILD=1 bun run --cwd packages/kilo-cli build --single --skip-install --skip-web-ui
KILO_INTERNAL_PROFILE_CUTOVER_BUILD=1 bun run --cwd packages/kilo-vscode package
```

This uses `.cache/pilot` in the CLI package, checks the private CLI manifest and executable SHA-256, and builds the private extension under `packages/kilo-vscode/.kilo-dev/pilot/`. The installable archive is in that directory's `out/`, not in the public publisher's input. Use only an isolated VS Code installation/profile when rehearsing it.
