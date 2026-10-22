package ai.kilocode.backend.rpc

import ai.kilocode.backend.workspace.KiloWorktreeIndexSettings
import kotlinx.coroutines.runBlocking
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class KiloAppRpcApiImplIndexWorktreesTest {

    @AfterTest
    fun tearDown() {
        KiloWorktreeIndexSettings.set(false)
    }

    @Test
    fun `indexWorktrees reflects persisted setting`() = runBlocking {
        val impl = KiloAppRpcApiImpl()

        assertFalse(impl.indexWorktrees())

        impl.setIndexWorktrees(true)

        assertTrue(impl.indexWorktrees())
        assertEquals(true, KiloWorktreeIndexSettings.get())
    }

    @Test
    fun `setIndexWorktrees is idempotent for an unchanged value`() = runBlocking {
        val impl = KiloAppRpcApiImpl()

        impl.setIndexWorktrees(false)

        assertFalse(impl.indexWorktrees())
    }
}
