package ai.kilocode.client.session.ui.prompt

import ai.kilocode.client.plugin.KiloBundle

private const val PASTE_LINES = 5
private const val PASTE_CHARS = 800

/** Counts lines in [text], matching the CLI's `(text.match(/\n/g)?.length ?? 0) + 1`. */
internal fun lines(text: String): Int = text.count { it == '\n' } + 1

/** Whether pasting [text] as-is should collapse into a `[Pasted ~N lines]` fold placeholder. */
internal fun collapsible(text: String): Boolean = lines(text) >= PASTE_LINES || text.length > PASTE_CHARS

/** The fold placeholder shown for a collapsed paste of [text]. */
internal fun placeholder(text: String): String = KiloBundle.message("prompt.paste.collapsed", lines(text))
