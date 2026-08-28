package ai.kilocode.client.session.context

import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.Service
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.openapi.vfs.VirtualFileManager
import com.intellij.openapi.vfs.newvfs.BulkFileListener
import com.intellij.openapi.vfs.newvfs.events.VFileEvent
import java.util.concurrent.ConcurrentHashMap

/**
 * Caches the compiled [KiloIgnore] per workspace-root directory so editor-context
 * gathering does not re-read and re-compile the ignore files on every prompt.
 *
 * The compiled matcher is reused until a `.kilocodeignore` or `.gitignore` change
 * invalidates it via a VFS listener. This keeps the blocking VFS read (a remote `cwm`
 * round-trip in split mode) off the prompt-send path after the first prompt, instead of
 * repeating it for every message the user sends.
 */
@Service(Service.Level.PROJECT)
internal class KiloIgnoreCache : Disposable {
    private val cache = ConcurrentHashMap<String, KiloIgnore>()

    init {
        ApplicationManager.getApplication().messageBus.connect(this)
            .subscribe(VirtualFileManager.VFS_CHANGES, object : BulkFileListener {
                override fun after(events: List<VFileEvent>) {
                    if (events.any { relevant(it) }) cache.clear()
                }
            })
    }

    /** Returns the cached matcher for [root], compiling and caching it on first use. */
    fun matcher(root: VirtualFile?): KiloIgnore {
        if (root == null) return KiloIgnore.EMPTY
        return cache.getOrPut(root.url) { KiloIgnore.load(root) }
    }

    override fun dispose() = cache.clear()

    private fun relevant(event: VFileEvent): Boolean {
        val name = event.path.substringAfterLast('/')
        return name == KiloIgnore.KILO || name == KiloIgnore.GIT
    }
}
