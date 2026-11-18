# Kilo complexity and file-size ratchet

The `kilo packages` PR check compares changed Kilo-owned product TypeScript with the branch it targets. A new function above Oxlint complexity 20 fails, a new file above 1,000 physical lines fails, and existing excess cannot grow. The base is Git history, so there is no editable baseline to refresh.

Scope is `packages/kilo-*/src`, `packages/kilo-vscode/webview-ui` and `packages/*/src/kilocode`. Tests, locale and i18n directories, fixtures, stories, examples, generated declarations, vendored code (including `continuedev`), symbolic links and copies registered in `script/upstream/mirrors.json` are outside the gate. The extension's static `.oxlintrc.json` limits still apply; where they overlap, the stricter one wins.

An over-limit function keeps its current score as its ceiling only while its declaration line is unchanged: Git zero-context hunks map the same line and column in the base, so editing the body or the surrounding file keeps the inherited cap. A changed declaration line, a rename or a new function starts at 20. `eslint-disable`/`oxlint-disable` comments are ignored, because they belong to the project lint run rather than this measurement. Scores never pool between functions.

Prefer a behavior-preserving extraction over a lower score: split a decision or dispatch path, keep one authorization or validation path in a single place, and test the extracted behavior. A cohesive file is fine; do not split code only to move a number.

See [the ratchet policy](AGENTS.md): ask a human maintainer **before** raising a limit or adding an exclusion. A justification in the PR is not approval.

To reproduce from the repository root after `bun install --frozen-lockfile`:

```sh
bun script/kilocode/metrics/check.ts
```

It compares with `git merge-base origin/v2 HEAD` and takes another revision as its argument. CI passes `HEAD^1`, the first parent of the PR merge. Failures print the file, line, column, measured score and allowed score, and exit nonzero. Each regression belongs to a changed file only, so unrelated code does not fail a PR.

Run the gate's own tests from this directory:

```sh
bun test check.test.ts
```
