package ai.kilocode.client.session.history

import ai.kilocode.client.session.SessionActivityKind
import junit.framework.TestCase

class HistoryActivitySnapshotTest : TestCase() {
    fun `test activity kind change is changed`() {
        val prev = HistoryActivitySnapshot(activity = mapOf("ses_1" to SessionActivityKind.RUNNING))
        val next = HistoryActivitySnapshot(activity = mapOf("ses_1" to SessionActivityKind.QUESTION))

        assertEquals(setOf("ses_1"), prev.changed(next))
    }

    fun `test activity removal is changed`() {
        val prev = HistoryActivitySnapshot(activity = mapOf("ses_1" to SessionActivityKind.RUNNING))

        assertEquals(setOf("ses_1"), prev.changed(HistoryActivitySnapshot()))
    }

    fun `test title change is changed`() {
        val prev = HistoryActivitySnapshot(
            activity = mapOf("ses_1" to SessionActivityKind.RUNNING),
            titles = mapOf("ses_1" to "Old"),
        )
        val next = HistoryActivitySnapshot(
            activity = mapOf("ses_1" to SessionActivityKind.RUNNING),
            titles = mapOf("ses_1" to "New"),
        )

        assertEquals(setOf("ses_1"), prev.changed(next))
    }

    fun `test title removal is changed`() {
        val prev = HistoryActivitySnapshot(titles = mapOf("ses_1" to "Live"))

        assertEquals(setOf("ses_1"), prev.changed(HistoryActivitySnapshot()))
    }

    fun `test disposed overlay removal is changed once`() {
        val prev = HistoryActivitySnapshot(
            activity = mapOf("ses_1" to SessionActivityKind.PERMISSION),
            titles = mapOf("ses_1" to "Live"),
        )

        assertEquals(setOf("ses_1"), prev.changed(HistoryActivitySnapshot()))
    }

    fun `test unchanged maps are not changed`() {
        val prev = HistoryActivitySnapshot(
            activity = mapOf("ses_1" to SessionActivityKind.PERMISSION),
            titles = mapOf("ses_1" to "Live"),
        )

        assertEquals(emptySet<String>(), prev.changed(prev.copy()))
    }

    fun `test changed ids are unioned`() {
        val prev = HistoryActivitySnapshot(
            activity = mapOf("ses_1" to SessionActivityKind.RUNNING),
            titles = mapOf("ses_2" to "Old"),
        )
        val next = HistoryActivitySnapshot(
            activity = mapOf("ses_1" to SessionActivityKind.QUESTION),
            titles = mapOf("ses_2" to "New"),
        )

        assertEquals(setOf("ses_1", "ses_2"), prev.changed(next))
    }
}
