package ai.kilocode.client.session.history

import ai.kilocode.client.app.KiloSessionService
import ai.kilocode.client.app.Workspace
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.SessionRef
import ai.kilocode.rpc.dto.CloudSessionDto
import ai.kilocode.rpc.dto.SessionDto
import com.intellij.openapi.application.ApplicationManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

class HistoryController(
    private val sessions: KiloSessionService,
    private val workspace: Workspace,
    private val cs: CoroutineScope,
    open: (SessionRef) -> Unit = {},
    private val deleted: (String) -> Unit = {},
) {
    companion object {
        const val CLOUD_LIMIT = 150
    }

    val local = HistoryModel<LocalHistoryItem>()
    val cloud = CloudHistoryModel()

    private val deleting = mutableSetOf<String>()
    private val opener = open
    private var git: String? = null

    fun reload(gitUrl: String? = null) {
        reloadLocal()
        reloadCloud(gitUrl)
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

    fun reloadCloud(gitUrl: String? = null) {
        git = gitUrl
        loadCloud(reset = true)
    }

    fun loadMoreCloud() {
        if (cloud.cursor == null || cloud.loading) return
        loadCloud(reset = false)
    }

    fun delete(item: LocalHistoryItem) {
        edt {
            if (item.id in deleting) return@edt
            deleting.add(item.id)
            local.refresh()
            cs.launch {
                try {
                    sessions.deleteSession(item.id, item.directory ?: workspace.directory)
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

    fun deleting(item: LocalHistoryItem): Boolean = item.id in deleting

    fun open(item: LocalHistoryItem) {
        edt { opener(SessionRef.Local(item.session)) }
    }

    fun open(item: CloudHistoryItem) {
        edt { opener(SessionRef.Cloud(item.session)) }
    }

    private fun loadCloud(reset: Boolean) {
        val cursor = cloud.cursor.takeUnless { reset }
        val gitUrl = git
        edt { cloud.start(reset) }
        cs.launch {
            try {
                val result = sessions.cloudSessions(workspace.directory, cursor, CLOUD_LIMIT, gitUrl)
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
