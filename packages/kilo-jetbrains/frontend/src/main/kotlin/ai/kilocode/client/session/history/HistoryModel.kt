package ai.kilocode.client.session.history

import javax.swing.AbstractListModel

open class HistoryModel<T : HistoryItem> : AbstractListModel<T>() {
    private var all = emptyList<T>()
    private var rows = emptyList<T>()
    private var query = ""

    var loading = false
        private set
    var error: String? = null
        private set
    var loaded = false
        private set

    val items: List<T> get() = all
    val visibleItems: List<T> get() = rows

    override fun getSize(): Int = rows.size

    override fun getElementAt(index: Int): T = rows[index]

    fun start() {
        loading = true
        error = null
        refresh()
    }

    fun replace(items: List<T>) {
        all = HistoryTime.sorted(items)
        loading = false
        loaded = true
        error = null
        filter()
    }

    fun append(items: List<T>) {
        all = HistoryTime.sorted(all + items)
        loading = false
        loaded = true
        error = null
        filter()
    }

    fun remove(id: String) {
        all = all.filterNot { it.id == id }
        filter()
    }

    fun update(item: T) {
        if (all.none { it.id == item.id }) return
        all = HistoryTime.sorted(all.map { if (it.id == item.id) item else it })
        filter()
    }

    fun fail(message: String) {
        loading = false
        loaded = true
        error = message
        refresh()
    }

    fun setFilter(value: String) {
        query = value.trim().lowercase()
        filter()
    }

    fun refresh() {
        val end = size.coerceAtLeast(1) - 1
        fireContentsChanged(this, 0, end)
    }

    protected fun clear() {
        all = emptyList()
        filter()
    }

    private fun filter() {
        val old = rows.size
        rows = all.filter(::matches)
        val new = rows.size
        when {
            old > new -> {
                if (new > 0) fireContentsChanged(this, 0, new - 1)
                fireIntervalRemoved(this, new, old - 1)
            }
            new > old -> {
                if (old > 0) fireContentsChanged(this, 0, old - 1)
                fireIntervalAdded(this, old, new - 1)
            }
            new > 0 -> fireContentsChanged(this, 0, new - 1)
        }
    }

    private fun matches(item: T): Boolean {
        if (query.isEmpty()) return true
        if (item.title.lowercase().contains(query)) return true
        if (item.id.lowercase().contains(query)) return true
        if (item is LocalHistoryItem && item.directory?.lowercase()?.contains(query) == true) return true
        return false
    }
}

class CloudHistoryModel : HistoryModel<CloudHistoryItem>() {
    var cursor: String? = null
        private set

    fun start(reset: Boolean) {
        cursor = cursor.takeUnless { reset }
        start()
        if (reset && !loaded) clear()
    }

    fun replace(items: List<CloudHistoryItem>, next: String?) {
        cursor = next
        replace(items)
    }

    fun append(items: List<CloudHistoryItem>, next: String?) {
        cursor = next
        append(items)
    }
}
