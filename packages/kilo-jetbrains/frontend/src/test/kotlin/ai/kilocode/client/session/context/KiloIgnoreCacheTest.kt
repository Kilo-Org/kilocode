package ai.kilocode.client.session.context

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.service
import com.intellij.openapi.vfs.VfsUtil
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.util.ui.UIUtil
import kotlinx.coroutines.runBlocking

class KiloIgnoreCacheTest : BasePlatformTestCase() {
    fun `test matcher caches until ignore file changes`() {
        val file = myFixture.addFileToProject(".kilocodeignore", "ignored/\n").virtualFile
        val root = file.parent
        val cache = project.service<KiloIgnoreCache>()

        val first = runBlocking { cache.matcher(root) }
        assertTrue(first.ignored("ignored/Secret.kt"))
        assertFalse(first.ignored("src/App.kt"))
        assertSame(first, runBlocking { cache.matcher(root) })

        ApplicationManager.getApplication().runWriteAction {
            VfsUtil.saveText(file, "src/\n")
        }
        UIUtil.dispatchAllInvocationEvents()

        val second = runBlocking { cache.matcher(root) }
        assertNotSame(first, second)
        assertFalse(second.ignored("ignored/Secret.kt"))
        assertTrue(second.ignored("src/App.kt"))
    }

    fun `test null root allows everything`() {
        assertSame(KiloIgnore.EMPTY, runBlocking { project.service<KiloIgnoreCache>().matcher(null) })
    }
}
