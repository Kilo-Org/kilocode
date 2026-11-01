package ai.kilocode.client.ui.tree

import ai.kilocode.client.ui.active.ActiveItem

internal data class ActiveTreeActions(
    val cell: (String, String) -> Unit = { _, _ -> },
    val open: ((ActiveItem, Boolean) -> Unit)? = null,
    val activate: ((ActiveItem) -> Unit)? = null,
    val click: ((ActiveItem) -> Unit)? = null,
    val select: (() -> Unit)? = null,
    val hover: ((ActiveItem?) -> Unit)? = null,
    val openOnClick: Boolean = true,
)
