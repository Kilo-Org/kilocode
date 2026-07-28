---
"@kilocode/cli": patch
---

Non-interactive `kilo run` no longer reports success for runs that did not complete. A plain
headless run (neither `--auto` nor `--dangerously-skip-permissions`) in which the CLI
auto-rejected at least one permission ask now exits 1 with a stderr diagnostic naming the cause,
and a run whose session errors mid-stream now prints that diagnostic to stderr under
`--format json` as well (previously the JSON branch swallowed it). Runs that complete their turn
with no auto-rejected permission still exit 0. Under `--format json` the auto-reject path adds a
new `error` event to the stream; existing event shapes are unchanged. The same exit-1 rule applies
to a plain non-interactive `--attach` run that auto-rejects an ask (that run was equally crippled);
interactive mode is untouched.
