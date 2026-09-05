# Indexing sidebar — local v2 adapter

The Kilo sidebar now reads the real location-scoped engine status through
`kilocode.indexing`. It uses the existing `sidebar.content` slot; no upstream
sidebar implementation is copied or changed.

| Surface | Source / behavior | Validation boundary |
|---|---|---|
| State | Canonical `@kilocode/indexing/status` schema, returned by the active `IndexingHost` | Disabled, loading and unavailable remain distinct. |
| Progress | Engine processed/total file counts and percentage | Shown only during indexing with a nonzero total. No inferred completion. |
| Refresh | Location change plus bounded polling of an enabled engine | Cancels on unmount/location change; disabled status does not poll. |
| Consent off | Lightweight status-only plugin when no indexing configuration is supplied | No engine initialization, index directory, or embedding request. |
| Scope | Current session Location, not process cwd | Existing real-host semantic-search test also checks the same status RPC. |

`test/sidebar-indexing-ui.test.tsx` boots the real isolated host and TUI, reads
disabled status, checks the visible section across a resize, and verifies that
reading it creates no index, message or inbox work. The engine integration test
checks enabled status through the public RPC alongside real loopback embeddings
and LanceDB search. Tests use no live account or paid inference.

This is one completed sidebar slice, not completion of the coarse CLI/TUI row.
Background processes, PR details, additional usage presentation and Plan remain
separate acceptance items. The UI exposes only state and numeric progress, not
provider configuration, API keys or arbitrary engine error text.
