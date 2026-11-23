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
        store.begin(first)
        val second = requireNotNull(store.remember("/repo", "feature", "main", PendingPrompt("second")))
        store.begin(second)

        store.bind(second, "/checkout/second")
        store.finish(second)
        store.bind(first, "/checkout/first")
        store.finish(first)

        assertEquals("first", store.peek("/checkout/first")?.text)
        assertEquals("second", store.peek("/checkout/second")?.text)
        store.bind(first, "/checkout/wrong")
        assertNull(store.peek("/checkout/wrong"))
    }

    fun `test lease and failed editor disposal never consume the prompt`() = edtWait {
        val store = PendingWorktreePrompt()
        store.put("/repo", "/checkout", PendingPrompt("keep me"))
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
        store.put("/repo", "/checkout", PendingPrompt("original", "plan", "kilo", "opus", "high", "Initial prompt"))
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

    fun `test binding a recreated checkout evicts its previous prompt and claim`() = edtWait {
        val store = PendingWorktreePrompt()
        store.put("/repo", "/checkout", PendingPrompt("obsolete"))
        val owner = Disposer.newDisposable(testRootDisposable)
        val old = requireNotNull(store.claim("/checkout", "ses_old", owner))
        val prompt = PendingPrompt("replacement", "plan", "kilo", "opus", "high")
        val id = requireNotNull(store.remember("/repo", "feature", "main", prompt))

        store.bind(id, "/checkout/")
        assertEquals(listOf(id), store.getState().entries.keys.toList())
        store.acknowledge("/checkout", old.id, "ses_old")
        assertEquals(prompt, store.peek("/checkout")?.prompt)
        assertNotNull(store.claim("/checkout", "ses_new", owner))
        store.acknowledge("/checkout", id, "ses_new")

        assertNull(store.peek("/checkout"))
        assertNull(restart(store).peek("/checkout"))
    }

    fun `test late older completion cannot replace a newer checkout prompt`() = edtWait {
        val store = PendingWorktreePrompt()
        val first = requireNotNull(store.remember("/repo", "feature", "main", PendingPrompt("old")))
        store.begin(first)
        val second = requireNotNull(store.remember("/repo", "feature", "main", PendingPrompt("new")))
        store.begin(second)

        store.bind(second, "/checkout")
        store.finish(second)
        store.bind(first, "/checkout/")
        store.finish(first)

        assertEquals(second, store.peek("/checkout")?.id)
        assertEquals("new", store.peek("/checkout")?.text)
        assertEquals(1, store.getState().entries.size)
    }

    fun `test late completion cannot resurrect a prompt after newer acknowledgement or removal`() = edtWait {
        for (ack in listOf(true, false)) {
            val store = PendingWorktreePrompt()
            val first = requireNotNull(store.remember("/repo", "feature", "main", PendingPrompt("old")))
            store.begin(first)
            val second = requireNotNull(store.remember("/repo", "feature", "main", PendingPrompt("new")))
            store.begin(second)
            store.bind(second, "/checkout")
            store.finish(second)
            val owner = Disposer.newDisposable(testRootDisposable)
            assertNotNull(store.claim("/checkout", "ses_new", owner))
            if (ack) store.acknowledge("/checkout", second, "ses_new")
            if (!ack) store.forget("/checkout")

            val restored = restart(store)
            restored.bind(first, "/checkout")
            restored.finish(first)

            assertNull(restored.peek("/checkout"))
            assertTrue(restored.getState().entries.isEmpty())
        }
    }

    fun `test identical concurrent submissions own independent tokens`() = edtWait {
        val store = PendingWorktreePrompt()
        val prompt = PendingPrompt("identical", "plan", "kilo", "opus", "high")
        val first = requireNotNull(store.remember("/repo", "feature", "main", prompt))
        store.begin(first)
        val second = requireNotNull(store.remember("/repo", "feature", "main", prompt))
        store.begin(second)
        assertFalse(first == second)

        store.finish(first)
        store.remember("/repo", "retry", "main", PendingPrompt("replacement draft"))
        store.bind(second, "/checkout")
        store.finish(second)

        assertEquals(prompt, store.peek("/checkout")?.prompt)
        assertEquals("replacement draft", store.draft("/repo")?.text)
    }

    fun `test restart preserves both submitted in flight creation prompts`() = edtWait {
        val store = PendingWorktreePrompt()
        val first = requireNotNull(store.remember("/repo", "first", "main", PendingPrompt("first")))
        store.begin(first)
        val second = requireNotNull(store.remember("/repo", "second", "main", PendingPrompt("second")))
        store.begin(second)

        val restored = restart(store)

        assertEquals(setOf(first, second), restored.getState().entries.keys)
        assertTrue(restored.getState().entries.values.all { it.creating })
        assertEquals(second, restored.draft("/repo")?.id)
        restored.bind(second, "/checkout/second")
        assertEquals(first, restored.draft("/repo")?.id)
        restored.bind(first, "/checkout/first")
        assertEquals("first", restored.peek("/checkout/first")?.text)
        assertEquals("second", restored.peek("/checkout/second")?.text)
    }

    fun `test superseded drafts are pruned while active creation tokens survive`() = edtWait {
        val store = PendingWorktreePrompt()
        val active = requireNotNull(store.remember("/repo", "first", "main", PendingPrompt("in flight")))
        store.begin(active)
        repeat(32) {
            store.remember("/repo", "retry", "base-$it", PendingPrompt("retry $it"), it % 2 == 0)
            assertEquals(2, store.getState().entries.size)
        }
        assertEquals("retry 31", store.draft("/repo")?.text)
        store.finish(active)

        val restored = restart(store)
        assertEquals(1, restored.getState().entries.size)
        assertEquals("retry 31", restored.draft("/repo")?.text)
    }

    fun `test retrying a submitted draft promotes a new independent latest intent`() = edtWait {
        val store = PendingWorktreePrompt()
        val prompt = PendingPrompt("first")
        val id = requireNotNull(store.remember("/repo", "first", "main", prompt))
        store.begin(id)
        store.remember("/repo", "second", "main", PendingPrompt("second"))

        val retry = requireNotNull(store.remember("/repo", "first", "main", prompt))

        assertFalse(id == retry)
        assertEquals(retry, store.draft("/repo")?.id)
        assertEquals(setOf(id, retry), store.getState().entries.keys)
    }

    fun `test loading legacy duplicate paths and superseded drafts keeps only the latest`() = edtWait {
        val store = PendingWorktreePrompt()
        store.put("/repo", "/checkout", PendingPrompt("old bound"))
        val state = store.getState()
        state.entries["new"] = state.entries.values.single().copy(id = "new", text = "new bound")
        state.entries["first"] = PendingWorktreePrompt.Entry(id = "first", directory = "/repo", text = "old draft")
        state.entries["last"] = PendingWorktreePrompt.Entry(id = "last", directory = "/repo", text = "latest draft")
        store.loadState(state)

        val restored = restart(store)
        assertEquals(2, restored.getState().entries.size)
        assertEquals("new bound", restored.peek("/checkout")?.text)
        assertEquals("latest draft", restored.draft("/repo")?.text)
    }

    fun `test releasing a deleted session rotates correlation and preserves explicit recovery`() = edtWait {
        val store = PendingWorktreePrompt()
        val prompt = PendingPrompt("keep choices", "plan", "kilo", "opus", "high")
        val owner = Disposer.newDisposable(testRootDisposable)
        store.put("/repo", "/checkout", prompt)
        val old = requireNotNull(store.claim("/checkout", "ses_deleted", owner))

        store.release("/checkout/", "ses_other")
        assertEquals(old.id, store.peek("/checkout")?.id)
        store.release("/checkout/", "ses_deleted")
        val recovered = requireNotNull(store.peek("/checkout"))
        assertFalse(old.id == recovered.id)
        assertNull(recovered.session)
        assertTrue(recovered.attempted)
        assertEquals(prompt, recovered.prompt)
        store.attempted(old.id, "stale callback")
        store.acknowledge("/checkout", old.id, "ses_deleted")
        assertEquals(recovered, store.peek("/checkout"))
        assertNotNull(store.claim("/checkout", "ses_new", owner))
        store.acknowledge("/checkout", old.id, "ses_new")
        assertNotNull(store.peek("/checkout"))
        store.acknowledge("/checkout", recovered.id, "ses_new")
        assertNull(store.peek("/checkout"))
    }

    fun `test reconciliation only forgets missing bound checkouts in its own repository`() = edtWait {
        val store = PendingWorktreePrompt()
        val missing = requireNotNull(store.remember("/repo", "missing", "main", PendingPrompt("missing")))
        store.bind(missing, "/checkout/missing")
        val other = requireNotNull(store.remember("/other", "other", "main", PendingPrompt("other")))
        store.bind(other, "/checkout/other")
        val draft = requireNotNull(store.remember("/repo", "draft", "main", PendingPrompt("retry")))

        store.reconcile("/repo/", listOf("/repo"), store.bound("/repo"))

        assertNull(store.peek("/checkout/missing"))
        assertEquals(other, store.peek("/checkout/other")?.id)
        assertEquals(draft, store.draft("/repo")?.id)
        store.forget("/checkout/other/")
        assertNull(store.peek("/checkout/other"))
        assertEquals(draft, restart(store).draft("/repo")?.id)
    }

    fun `test old listing cannot prune a prompt bound after it started`() = edtWait {
        val store = PendingWorktreePrompt()
        val before = store.bound("/repo")
        val id = requireNotNull(store.remember("/repo", "new", "main", PendingPrompt("new prompt")))
        store.bind(id, "/checkout/new")

        store.reconcile("/repo", listOf("/repo"), before)

        assertEquals(id, store.peek("/checkout/new")?.id)
    }

    fun `test queued prompts keep repository ownership across restart and external deletion`() = edtWait {
        val store = PendingWorktreePrompt()
        val prompt = PendingPrompt("update from base", injectedTitle = "Update from main")
        store.put("/repo/", "/checkout/queued/", prompt)
        store.put("/other", "/other-checkout", PendingPrompt("unrelated"))
        val restored = restart(store)
        val queued = requireNotNull(restored.peek("/checkout/queued"))
        assertEquals("/repo", queued.directory)
        assertEquals(prompt, queued.prompt)
        assertEquals(setOf(queued.id), restored.bound("/repo/"))

        restored.reconcile("/repo", listOf("/repo", "/checkout/queued"), restored.bound("/repo"))
        assertEquals(queued, restored.peek("/checkout/queued"))
        restored.reconcile("/repo", listOf("/repo"), restored.bound("/repo"))

        assertNull(restored.peek("/checkout/queued"))
        assertEquals("unrelated", restored.peek("/other-checkout")?.text)
        assertFalse(restart(restored).getState().entries.values.any { it.text == prompt.text })
    }

    fun `test an older listing cannot prune a queued prompt added after its snapshot`() = edtWait {
        val store = PendingWorktreePrompt()
        val before = store.bound("/repo")
        store.put("/repo", "/checkout/queued", PendingPrompt("keep newer queued prompt"))

        store.reconcile("/repo", listOf("/repo"), before)

        assertEquals("keep newer queued prompt", store.peek("/checkout/queued")?.text)
    }

    private fun restart(store: PendingWorktreePrompt): PendingWorktreePrompt {
        val xml = XmlSerializer.serialize(store.getState())
        val state = XmlSerializer.deserialize(xml, PendingWorktreePrompt.State::class.java)
        return PendingWorktreePrompt().apply { loadState(state) }
    }
}
