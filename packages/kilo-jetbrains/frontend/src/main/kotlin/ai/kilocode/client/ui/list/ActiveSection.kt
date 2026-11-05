package ai.kilocode.client.ui.list

import ai.kilocode.client.ui.active.ActiveItem

internal interface ActiveSection : ActiveItem {
    val section: String?
}

internal val ActiveItem.section: String?
    get() = (this as? ActiveSection)?.section
