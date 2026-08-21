package ai.kilocode.backend.rpc

import com.intellij.testFramework.fixtures.BasePlatformTestCase
import kotlinx.coroutines.runBlocking

class KiloRunRpcApiImplTest : BasePlatformTestCase() {
    fun testResolvesProjectByDirectory() = runBlocking {
        val api = KiloRunRpcApiImpl()
        val dir = requireNotNull(project.basePath)
        assertNull(api.configs(dir).error)
        assertNotNull(api.configs("/kilo/definitely/missing").error)
        assertNotNull(api.run("/kilo/definitely/missing", "id", "/wt").error)
        assertFalse(api.stop("/kilo/definitely/missing", "id", "/wt"))
        assertFalse(api.focus("/kilo/definitely/missing", "id", "/wt"))
    }
}
