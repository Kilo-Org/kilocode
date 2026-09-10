# Goal 79 scope boundary — 2026-09-07

The canonical inventory has 44 rows: one obsolete, 43 active, and 31 accepted
(28 done plus three upstream-equivalent). The target requires 34 accepted rows.
No partial implementation or skipped external check receives credit.

## Remaining routes

| Rows | Current boundary |
|---|---|
| Sharing | Explicit target deployment/end-to-end gates remain; the attempted local service bundle also lacks cached pg 8.20.0. Viewer compatibility and deletion/revert contracts remain incomplete. |
| Remote | Local translations and suggestions are verified; the documented compatibility and deployment boundaries remain open. |
| Updater/packaging | Actual macOS portable apply/rollback is verified; other-platform and distribution/release requirements remain open. |
| Six IDE rows | VS Code/JetBrains implementation is explicitly deferred by the current execution scope. |
| Three previously unknown cross-client rows | Their defining consumers are editor features, as classified below. They are not CLI substitutes or completed rows. |

Even accepting remote and packaging in full would produce only 33/43. Closing
the 79% goal therefore also requires sharing acceptance or reopening deferred
client work. Neither changing the denominator nor counting host-only halves
satisfies the goal.

## Cross-client classification

The audit used local v1 commit `ecccd1f` and current v2 source. Paths below are
paths in that pinned v1 tree, not claims that those files exist in this worktree.

- **Inline autocomplete/FIM:**
  `packages/kilo-vscode/src/services/autocomplete/classic-auto-complete/AutocompleteInlineCompletionProvider.ts`
  implements editor completion using VS Code context and FIM construction.
  Ghost-text presentation, acceptance, and re-trigger behavior require the
  deferred editor consumer. A host proxy alone is partial.
- **Code actions, enhance prompt, commit generation:**
  `packages/kilo-vscode/src/services/code-actions/code-action-provider.ts`
  implements `vscode.CodeActionProvider`; the remaining actions use editor/SCM
  consumers and host generation endpoints. Porting just those endpoints cannot
  close this composite row.
- **Voice/speech-to-text:**
  `packages/kilo-vscode/src/speech-to-text/transcribe.ts` sends captured audio to
  `/kilo/audio/transcriptions`; the feature also needs microphone capture and
  transcription-provider behavior. The existing editor capture surface is
  deferred, and external provider acceptance is unavailable under local-only
  execution.

Detailed delegate evidence is in parent-task thread storage:
`thr_qc5c8kziy3/goal79-cross-client-remaining-audit.md`. The parent directly
checked the completion provider, code-action provider, and transcription
request source; the completion-provider filename above corrects the audit's
`AutocompleteInlineCompletionItemProvider.ts` path typo.

## Subsequent continuation

After the scope question, the user instructed "Continue the goal". Work resumed
with local IDE implementation as the next route, preserving the prohibition on
external hosts. The deferrals above describe the audited earlier boundary;
they no longer prevent starting VS Code integration. Acceptance requirements
and the 43-row denominator remain unchanged. Coverage remains 31/43.
