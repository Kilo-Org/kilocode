# NES Test Playground — Instructions

These tests are designed so that the source files contain **no hints** about what Mercury is supposed to predict. All cursor placements and expected behaviors live here. Don't open this file inside the Dev Host while testing — keep it in a separate window so the model can't see it.

## One-time setup

1. **`bun run watch`** is already running for the kilocode extension.
2. In the kilocode VSCode window, press **F5** → opens the **Extension Development Host**.
3. In the Dev Host: `File → Open Folder…` → `packages/kilo-vscode/docs/nes-examples/` inside this repo.
4. Open Settings (`Cmd+,`), confirm:
   - `kilo-code.new.autocomplete.enableAutoTrigger` → ✓ (default true)
   - `kilo-code.new.autocomplete.model` → **Mercury Next Edit (Inception)** ← *NOT* "Mercury Edit 2", which is the classic FIM option
   - `kilo-code.new.autocomplete.nextEdit.apiKey` → your `sk_...` key
   - VSCode global `editor.inlineSuggest.enabled` → ✓
5. To watch the pipeline live: `View → Output` → pick the **"Kilo Code · Next Edit"** channel.

## Conventions used below

- **Cursor placement**: where to click in the file before waiting.
- **Expected (editor)**: what should appear on screen.
- **Expected (channel)**: a stripped-down line you should see in the Next Edit output channel.
- **Path**: which NES rendering path this exercises — same-line ghost / off-cursor replace / off-cursor insert / suppressed.

After each test, **don't accept** if you want to re-run it — the suggestion will edit the file. Either `Cmd+Z` after accept, or just navigate to the next test file.

---

## Core tests (Python)

### 01 — Finish a function body  *(path: same-line insert)*
- **File**: `01_finish_function_body.py`
- **Cursor**: the empty indented line at the end of `factorial` (column 4).
- **Expected editor**: ghost text proposing the recursive case.
- **Expected channel**: `diff at lines [N..N], cursor at line N`, then `RENDER`.

### 02 — Pattern continuation  *(path: same-line ghost)*
- **File**: `02_pattern_continuation.py`
- **Cursor**: end of the last line (after `COLOR_BLUE = `).
- **Expected editor**: ghost text appending a hex color.
- **Expected channel**: `diff at lines [N..N], cursor at line N`, then `RENDER`.

### 03 — Mid-identifier completion  *(path: same-line ghost)*
- **File**: `03_typo_completion.py`
- **Cursor**: end of the file (after `return tot`).
- **Expected editor**: ghost text completing the identifier.
- **Path**: same-line.

### 04 — Loop body inference  *(path: same-line insert)*
- **File**: `04_loop_body.py`
- **Cursor**: the empty indented line inside the `for` loop (column 8).
- **Expected editor**: ghost text proposing the accumulator update.

### 05 — Sibling method body  *(path: same-line insert)*
- **File**: `05_class_method.py`
- **Cursor**: empty indented line inside `pop` (column 8).
- **Expected editor**: ghost text proposing the pop body.

---

## Advanced Python tests

### 07 — Multi-line rename refactor  *(path: off-cursor replace)*
- **File**: `07_multiline_rename_refactor.py`
- **Cursor**: end of the line with `def compute_user_score(user_id, weight):` (the renamed signature). The body below still uses the old `u` / `w` names.
- **Expected editor**: strikethrough on the body lines + ghost showing the renamed body.
- **Tab**: jump, then apply.

### 08 — Mixed insert + replace  *(path: off-cursor replace, multi-line)*
- **File**: `08_mixed_insert_and_replace.py`
- **Cursor**: end of line `total = 0`.
- **Expected editor**: a decoration spanning the for-loop area showing the corrected accumulator body. The proposed text is longer than the original.

### 10 — Mid-token completion  *(path: same-line ghost)*
- **File**: `10_mid_token_completion.py`
- **Cursor**: end of the file (after `result = fib`).
- **Expected editor**: ghost extending the identifier and supplying a call.

### 11 — Stub method with implemented siblings  *(path: same-line insert)*
- **File**: `11_fill_sibling_method.py`
- **Cursor**: empty indented line inside `dequeue` (column 8).
- **Expected editor**: ghost text filling in the FIFO body.

### 12 — Type annotation insertion  *(path: same-line replace OR off-cursor replace)*
- **File**: `12_type_annotation_insertion.py`
- **Cursor**: on line `def add(a, b):` (anywhere on that line works; end-of-line is easiest).
- **Expected editor**: strikethrough + ghost showing the typed signature. May render as inline ghost depending on where you place the cursor on the line.

### 13 — Docstring generation  *(path: same-line insert)*
- **File**: `13_docstring_generation.py`
- **Cursor**: empty indented line directly under `def parse_iso_date(s):` (column 4).
- **Expected editor**: ghost text starting with `"""` and a one-line description.

### 14 — No-op suppression (NEGATIVE)  *(path: suppressed)*
- **File**: `14_no_op_suppression.py`
- **Cursor**: end of `return a + b`.
- **Expected editor**: NOTHING. No ghost, no decoration.
- **Expected channel**: either `identical replacement — no-op` or no `RENDER` line.
- **Fail mode**: any visible suggestion is a false positive.

---

## TypeScript

### ts_07 — Array transform  *(same-line)*
- **File**: `ts_07_array_transform.ts`
- **Cursor**: end of `return users` inside `getActiveUserNames`.
- **Expected editor**: ghost text completing a `.filter(...).map(...)` chain.

### ts_08 — Param type annotations  *(off-cursor replace)*
- **File**: `ts_08_param_types.ts`
- **Cursor**: end of file (after `main();`).
- **Expected editor**: strikethrough on `add(a, b)` signature + ghost showing the typed version.

### ts_09 — React event handler  *(same-line insert)*
- **File**: `ts_09_jsx_handler.tsx`
- **Cursor**: empty indented line inside `handleClick` (column 4).
- **Expected editor**: ghost text incrementing `count`.

---

## Go

### go_07 — Error handling  *(same-line insert, multi-line)*
- **File**: `go_07_error_handling.go`
- **Cursor**: empty line right after `data, err := os.ReadFile(path)`.
- **Expected editor**: ghost text proposing the canonical `if err != nil { return nil, err }` block.

### go_08 — Struct method body  *(same-line insert)*
- **File**: `go_08_struct_method.go`
- **Cursor**: empty indented line inside `Area()`.
- **Expected editor**: ghost text computing area from `Width` and `Height`.

### go_09 — Goroutine + channel  *(same-line insert, multi-line)*
- **File**: `go_09_goroutine_channel.go`
- **Cursor**: empty indented line inside the goroutine.
- **Expected editor**: ghost text producing values onto the channel and closing it.

---

## Rust

### rs_07 — Match-arm completion  *(same-line)*
- **File**: `rs_07_match_arms.rs`
- **Cursor**: empty indented line inside the `match s {` body, after the `Square` arm (column 8).
- **Expected editor**: ghost text proposing the missing `Rectangle` and `Triangle` arms.

### rs_08 — Result chaining  *(same-line ghost)*
- **File**: `rs_08_result_chain.rs`
- **Cursor**: end of the line `let n = s.trim()` (no semicolon yet).
- **Expected editor**: ghost text continuing the chain into a parsed `i32`.

### rs_09 — Lifetime annotation  *(off-cursor replace)*
- **File**: `rs_09_lifetimes.rs`
- **Cursor**: end of the file (after `main`'s closing `}`).
- **Expected editor**: strikethrough on the `fn longest(...)` signature + ghost showing the lifetime-annotated version.

---

## JavaScript

### js_07 — Async/await  *(same-line insert, multi-line)*
- **File**: `js_07_async_await.js`
- **Cursor**: empty indented line inside the `try {` block (column 8).
- **Expected editor**: ghost text completing fetch + json parse.

### js_08 — Express route handler  *(same-line insert, multi-line)*
- **File**: `js_08_express_route.js`
- **Cursor**: empty indented line inside the GET handler (column 4).
- **Expected editor**: ghost text implementing get-by-id (lookup, 404, json response).

---

## SQL

### sql_07 — JOIN clause  *(same-line ghost)*
- **File**: `sql_07_join.sql`
- **Cursor**: end of the line `FROM orders o`.
- **Expected editor**: ghost text completing the JOIN against `customers`.

### sql_08 — WHERE filter  *(same-line ghost)*
- **File**: `sql_08_where_filter.sql`
- **Cursor**: end of the bare `WHERE` line.
- **Expected editor**: ghost text proposing a predicate.

---

## Markdown (negative)

### md_07 — Prose, should stay quiet  *(suppressed)*
- **File**: `md_07_prose_negative.md`
- **Cursor**: end of the last sentence.
- **Expected editor**: NOTHING (ideally). If Mercury does propose a continuation of the prose, note it as a soft fail — code models writing your README isn't the v0 product.

---

## Troubleshooting

- **No log lines appearing**: confirm the output channel is "Kilo Code · Next Edit". Also confirm you reloaded the Dev Host after rebuilding.
- **`[NES] skip — no API key resolved`**: setting wasn't saved. Re-paste the key, hit Enter, reload.
- **`[NES] <- 400`**: regression on prompt shape — capture the body in the channel and ping the integration owner.
- **Visible suggestion that's not in this doc**: write it down. Unexpected wins (or false positives) are the most useful signal.
