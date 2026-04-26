#!/usr/bin/env node
/*
 * DaveAI package.json branding-preserving merge driver.
 *
 * Invoked by git when .gitattributes maps a file to:
 *     merge=daveai-package-json-branding
 *
 * Git invocation (per scripts/setup-merge-drivers.sh):
 *     node scripts/merge-package-json-branding.js %O %A %B %P
 *
 * Where:
 *     %O = ancestor   (common base, may be the empty file)
 *     %A = current    ("ours"   — DaveAI branch, the file we WRITE BACK to)
 *     %B = incoming   ("theirs" — upstream branch we are picking from)
 *     %P = pathname   (informational only)
 *
 * Strategy:
 *   1. Start with `incoming` as the merged base — we want upstream's new
 *      version, dependencies, scripts, contributes additions, etc.
 *   2. Override a fixed set of branding fields from `current` (DaveAI-owned).
 *   3. For nested fields like contributes.commands[*].title, prefer current's
 *      value if it appears DaveAI-customized (contains the literal "MAOS").
 *      Otherwise prefer incoming's value (so upstream's renames flow through).
 *   4. Write the result to %A (current). Git then sees no conflict markers
 *      and the cherry-pick / merge proceeds cleanly.
 *
 * Defensive behavior:
 *   - JSON parse error on any input → exit 1 with stderr message; git will
 *     fall back to the standard merge driver (conflict markers).
 *   - Missing branding field in `current` → silently skip (don't error).
 *   - Missing field in `incoming` that exists in `current` → keep current's.
 */

'use strict';

const fs = require('fs');

const BRANDING_FIELDS = [
    'displayName',
    'description',
    'publisher',
    'icon',
    'author',
    'homepage',
    'bugs',
    'repository',
];

const DAVEAI_MARKER = 'MAOS';

function readJson(label, p) {
    let raw;
    try {
        raw = fs.readFileSync(p, 'utf8');
    } catch (err) {
        process.stderr.write(
            `[merge-package-json-branding] cannot read ${label} file '${p}': ${err.message}\n`
        );
        process.exit(2);
    }
    // An empty ancestor file is legal (e.g. file added on both sides). Return {}.
    if (!raw.trim()) return {};
    try {
        return JSON.parse(raw);
    } catch (err) {
        process.stderr.write(
            `[merge-package-json-branding] JSON parse error in ${label} file '${p}': ${err.message}\n`
        );
        process.exit(1);
    }
}

function looksDaveAiCustomized(value) {
    if (typeof value === 'string') {
        return value.includes(DAVEAI_MARKER);
    }
    try {
        return JSON.stringify(value).includes(DAVEAI_MARKER);
    } catch (_) {
        return false;
    }
}

/**
 * Walk an array of command-like objects in current and incoming. Match by
 * `command` key. For each command present in both, if current's `title`
 * looks DaveAI-customized, keep current's title in the merged output;
 * otherwise keep incoming's. Commands present only in incoming are taken
 * verbatim. Commands present only in current are appended at the end (so
 * DaveAI-only commands survive an upstream removal).
 */
function mergeCommands(currentCmds, incomingCmds) {
    if (!Array.isArray(incomingCmds)) {
        return Array.isArray(currentCmds) ? currentCmds : incomingCmds;
    }
    if (!Array.isArray(currentCmds)) {
        return incomingCmds;
    }

    const currentByCommand = new Map();
    for (const c of currentCmds) {
        if (c && typeof c === 'object' && typeof c.command === 'string') {
            currentByCommand.set(c.command, c);
        }
    }

    const seenCommandNames = new Set();
    const merged = incomingCmds.map((inc) => {
        if (!inc || typeof inc !== 'object' || typeof inc.command !== 'string') {
            return inc;
        }
        seenCommandNames.add(inc.command);
        const cur = currentByCommand.get(inc.command);
        if (!cur) return inc;

        const out = Object.assign({}, inc);
        if (typeof cur.title === 'string' && looksDaveAiCustomized(cur.title)) {
            out.title = cur.title;
        }
        return out;
    });

    for (const c of currentCmds) {
        if (
            c &&
            typeof c === 'object' &&
            typeof c.command === 'string' &&
            !seenCommandNames.has(c.command) &&
            looksDaveAiCustomized(c)
        ) {
            merged.push(c);
        }
    }

    return merged;
}

function main() {
    const argv = process.argv.slice(2);
    if (argv.length < 3) {
        process.stderr.write(
            '[merge-package-json-branding] expected at least 3 args: %O %A %B [%P]\n'
        );
        process.exit(2);
    }
    const [ancestorPath, currentPath, incomingPath /*, fileName */] = argv;

    const _ancestor = readJson('ancestor', ancestorPath); // read for completeness; not used directly
    const current = readJson('current', currentPath);
    const incoming = readJson('incoming', incomingPath);

    // 1. Base = deep clone of incoming → upstream wins on fields we don't override.
    const merged = JSON.parse(JSON.stringify(incoming));

    // 2. Top-level branding fields → keep current's value where defined.
    for (const field of BRANDING_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(current, field) && current[field] !== undefined) {
            merged[field] = current[field];
        }
    }

    // 3. Keep any current top-level field that incoming dropped (defensive — e.g.
    //    upstream removes a key we still need). Skips fields already handled and
    //    skips ones incoming intentionally overwrites with a different value.
    for (const key of Object.keys(current)) {
        if (BRANDING_FIELDS.includes(key)) continue;
        if (!Object.prototype.hasOwnProperty.call(incoming, key)) {
            merged[key] = current[key];
        }
    }

    // 4. contributes.commands[*].title — prefer DaveAI-customized titles.
    if (
        current.contributes &&
        typeof current.contributes === 'object' &&
        Array.isArray(current.contributes.commands) &&
        merged.contributes &&
        typeof merged.contributes === 'object'
    ) {
        merged.contributes.commands = mergeCommands(
            current.contributes.commands,
            merged.contributes.commands
        );
    }

    // 5. Write back to %A. Use 2-space indent + trailing newline (matches the
    //    formatting of upstream's package.json so the resulting diff stays minimal).
    const out = JSON.stringify(merged, null, 2) + '\n';
    fs.writeFileSync(currentPath, out, 'utf8');

    process.exit(0);
}

main();
