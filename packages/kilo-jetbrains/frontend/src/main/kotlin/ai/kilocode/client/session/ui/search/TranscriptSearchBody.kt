package ai.kilocode.client.session.ui.search

import ai.kilocode.client.ui.md.MdView

/**
 * One conversation body that transcript search may inspect.
 *
 * Only the actual user/assistant prose renderer is exposed; tool, reasoning, diff, diagram, and
 * attachment renderers never implement this contract. [reveal] expands a collapsed injected prompt
 * without touching any excluded block.
 */
internal class TranscriptSearchBody(
    val key: String,
    val md: MdView,
    val reveal: () -> Unit,
    val collapsed: () -> Boolean,
)
