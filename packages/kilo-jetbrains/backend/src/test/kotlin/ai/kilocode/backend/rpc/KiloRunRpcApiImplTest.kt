package ai.kilocode.backend.rpc

import com.intellij.testFramework.fixtures.BasePlatformTestCase
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking

class KiloRunRpcApiImplTest : BasePlatformTestCase() {
    fun testResolvesProjectByDirectory() = runBlocking {
        val api = KiloRunRpcApiImpl()
        val dir = requireNotNull(project.basePath)
        assertNull(api.configs(dir).error)
        // A trailing slash must resolve the same project the workspace API would.
        assertNull(api.configs("$dir/").error)
        assertNotNull(api.configs("/kilo/definitely/missing").error)
        assertNotNull(api.run("/kilo/definitely/missing", "id", "/wt").error)
        assertNotNull(api.build("/kilo/definitely/missing", "/wt", false).error)
        assertFalse(api.stop("/kilo/definitely/missing", "id", "/wt"))
        assertFalse(api.focus("/kilo/definitely/missing", "id", "/wt"))
        assertFalse(api.release("/kilo/definitely/missing", "/wt"))
        // States for an unresolved project degrade to an empty list instead of failing the stream.
        assertTrue(api.states("/kilo/definitely/missing").first().isEmpty())
    }
}
