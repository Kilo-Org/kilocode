package ai.kilocode.client.agentManager.worktree

import ai.kilocode.client.util.edtWait
import com.intellij.openapi.util.Disposer
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.util.xmlb.XmlSerializer

class PendingWorktreePromptTest : BasePlatformTestCase() {
    fun `test confirmed creation draft survives IDE serialization before a path exists`() = edtWait {
        val store = PendingWorktreePrompt()
        val prompt = PendingPrompt("fix this", "plan", "kilo", "opus", "high")
        val id = requireNotNull(store.remember("/repo/", "feature", "release", prompt, true))
        assertEquals(id, store.remember("/repo", "feature", "release", prompt, true))

        val restored = restart(store)
        val draft = requireNotNull(restored.draft("/repo"))
        assertEquals(prompt, draft.prompt)
        assertEquals("feature", draft.branch)
        assertEquals("release", draft.base)
        assertTrue(draft.fetchBase)
        assertNull(restored.peek("/actual/checkout"))

        restored.bind(id, "/actual/checkout/")
        assertEquals(prompt, restored.peek("/actual/checkout")?.prompt)
        assertNull(restored.draft("/repo"))
    }

    fun `test out of order same branch completions bind only their own prompt`() = edtWait {
        val store = PendingWorktreePrompt()
        val first = requireNotNull(store.remember("/repo", "feature", "main", PendingPrompt("first")))
        val second = requireNotNull(store.remember("/repo", "feature", "main", PendingPrompt("second")))

        store.bind(second, "/checkout/second")
        store.bind(first, "/checkout/first")

        assertEquals("first", store.peek("/checkout/first")?.text)
        assertEquals("second", store.peek("/checkout/second")?.text)
        store.bind(first, "/checkout/wrong")
        assertNull(store.peek("/checkout/wrong"))
    }

    fun `test lease and failed editor disposal never consume the prompt`() = edtWait {
        val store = PendingWorktreePrompt()
        store.put("/checkout", PendingPrompt("keep me"))
        val first = Disposer.newDisposable()
        val second = Disposer.newDisposable()
        try {
            val entry = requireNotNull(store.claim("/checkout", "ses_first", first))
            assertNotNull(store.peek("/checkout"))
            assertNull(store.claim("/checkout", "ses_first", second))
            store.acknowledge("/checkout", "unrelated", "ses_first")
            store.acknowledge("/checkout", entry.id, "ses_other")
            assertNotNull(store.peek("/checkout"))

            Disposer.dispose(first)
            assertNull(store.claim("/checkout", "ses_other", second))
            assertNotNull(store.claim("/checkout", "ses_first", second))
            store.acknowledge("/checkout", entry.id, "ses_first")
            assertNull(store.peek("/checkout"))
            assertNull(restart(store).peek("/checkout"))
            store.acknowledge("/checkout", entry.id, "ses_first")
        } finally {
            if (!Disposer.isDisposed(first)) Disposer.dispose(first)
            Disposer.dispose(second)
        }
    }

    fun `test restart retains target session and uncertain send correlation`() = edtWait {
        val store = PendingWorktreePrompt()
        store.put("/checkout", PendingPrompt("original", "plan", "kilo", "opus", "high", "Initial prompt"))
        val owner = Disposer.newDisposable()
        val entry = requireNotNull(store.claim("/checkout", "ses_target", owner))
        store.attempted(entry.id, "edited retry")
        Disposer.dispose(owner)

        val restored = restart(store)
        val pending = requireNotNull(restored.peek("/checkout"))
        assertEquals(entry.id, pending.id)
        assertEquals("ses_target", pending.session)
        assertEquals("edited retry", pending.text)
        assertEquals(entry.prompt.copy(text = "edited retry"), pending.prompt)
        assertTrue(pending.attempted)
    }

    private fun restart(store: PendingWorktreePrompt): PendingWorktreePrompt {
        val xml = XmlSerializer.serialize(store.getState())
        val state = XmlSerializer.deserialize(xml, PendingWorktreePrompt.State::class.java)
        return PendingWorktreePrompt().apply { loadState(state) }
    }
}
