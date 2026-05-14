package ai.kilocode.client.session.history

import ai.kilocode.client.app.KiloSessionService
import ai.kilocode.client.app.Workspace
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.SessionRef
import ai.kilocode.rpc.dto.CloudSessionDto
import ai.kilocode.rpc.dto.SessionDto
import com.intellij.openapi.application.ApplicationManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

class HistoryController(
    private val sessions: KiloSessionService,
    private val workspace: Workspace,
    private val cs: CoroutineScope,
    open: (SessionRef) -> Unit = {},
    private val deleted: (String) -> Unit = {},
    private val gitUrlProvider: () -> String? = { resolveGitRemoteUrl(workspace.directory) },
) {
    companion object {
        const val CLOUD_LIMIT = 50
    }

    val local = HistoryModel<LocalHistoryItem>()
    val cloud = CloudHistoryModel()

    /** Resolved once on first cloud load; null means no remote found. Written from IO, read on EDT. */
    @Volatile
    var gitUrl: String? = null
        private set

    @Volatile
    private var resolved = false
    private val lock = Mutex()

    /** Whether to filter cloud history by the current repository. */
    var repoOnly: Boolean = false
        private set

    /** Notified on EDT when [repoOnly] changes (e.g. to update checkbox state). */
    var onRepoOnlyChanged: ((Boolean) -> Unit)? = null

    private fun updateRepoOnly(value: Boolean) {
        if (repoOnly == value) return
        repoOnly = value
        edt { onRepoOnlyChanged?.invoke(value) }
    }

    private val deleting = mutableSetOf<String>()
    private val opener = open

    fun reload() {
        reloadLocal()
        reloadCloud()
    }

    fun reloadLocal() {
        edt { local.start() }
        cs.launch {
            try {
                val result = sessions.list(workspace.directory)
                val items = result.sessions.map(::localItem)
                edt { local.replace(items) }
            } catch (e: Exception) {
                edt { local.fail(e.message ?: KiloBundle.message("history.error.local")) }
            }
        }
    }

    fun reloadCloud() {
        loadCloud(reset = true)
    }

    fun loadMoreCloud() {
        if (cloud.cursor == null || cloud.loading) return
        loadCloud(reset = false)
    }

    fun applyRepoOnly(value: Boolean) {
        updateRepoOnly(value)
        edt { reloadCloud() }
    }

    fun delete(item: LocalHistoryItem) {
        edt {
            if (item.id in deleting) return@edt
            deleting.add(item.id)
            local.refresh()
            val dir = item.directory ?: workspace.directory
            cs.launch {
                try {
                    sessions.deleteSession(item.id, dir)
                    edt {
                        deleting.remove(item.id)
                        local.remove(item.id)
                        deleted(item.id)
                    }
                } catch (e: Exception) {
                    edt {
                        deleting.remove(item.id)
                        local.fail(e.message ?: KiloBundle.message("history.error.local.delete"))
                    }
                }
            }
        }
    }

    fun rename(item: LocalHistoryItem, title: String) {
        val dir = item.directory ?: workspace.directory
        cs.launch {
            try {
                val updated = sessions.renameSession(item.id, dir, title)
                edt { local.update(LocalHistoryItem(updated)) }
            } catch (e: Exception) {
                edt { local.fail(e.message ?: KiloBundle.message("history.error.local.rename")) }
            }
        }
    }

    fun deleting(item: LocalHistoryItem): Boolean = item.id in deleting

    fun open(item: LocalHistoryItem) {
        edt { opener(SessionRef.Local(item.session)) }
    }

    fun open(item: CloudHistoryItem) {
        edt { opener(SessionRef.Cloud(item.session)) }
    }

    private fun loadCloud(reset: Boolean) {
        val cursor = cloud.cursor.takeUnless { reset }
        edt { cloud.start(reset) }
        cs.launch {
            val url = resolveUrlIfNeeded()
            val filter = if (repoOnly) url else null
            try {
                val result = sessions.cloudSessions(workspace.directory, cursor, CLOUD_LIMIT, filter)
                val items = result.sessions.map(::cloudItem)
                edt {
                    if (reset) cloud.replace(items, result.nextCursor)
                    else cloud.append(items, result.nextCursor)
                }
            } catch (e: Exception) {
                edt { cloud.fail(e.message ?: KiloBundle.message("history.error.cloud")) }
            }
        }
    }

    /**
     * Resolves [gitUrl] on first cloud load. Subsequent calls return the cached value.
     * Also enables [repoOnly] by default when a URL is found the first time.
     *
     * Must be called from a coroutine. Writes [gitUrl] directly (volatile) and then
     * propagates state updates to EDT via [edt].
     */
    private suspend fun resolveUrlIfNeeded(): String? {
        if (resolved) return gitUrl
        return lock.withLock {
            if (resolved) return@withLock gitUrl
            val url = withContext(Dispatchers.IO) {
                gitUrlProvider()
            }
            // Write gitUrl directly (volatile) so it is visible before EDT callbacks fire.
            gitUrl = url
            resolved = true
            if (url != null) updateRepoOnly(true)
            url
        }
    }
}

private fun edt(block: () -> Unit) {
    val app = ApplicationManager.getApplication()
    if (app.isDispatchThread) {
        block()
        return
    }
    app.invokeLater(block)
}

private fun localItem(session: SessionDto) = LocalHistoryItem(session)

private fun cloudItem(session: CloudSessionDto) = CloudHistoryItem(session)
