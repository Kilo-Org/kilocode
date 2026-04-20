package ai.kilocode.client.app

import ai.kilocode.rpc.KiloWorkspaceRpcApi
import ai.kilocode.rpc.dto.KiloWorkspaceStateDto
import ai.kilocode.rpc.dto.KiloWorkspaceStatusDto
import com.intellij.openapi.util.Disposer
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout

class KiloWorkspaceServiceTest : BasePlatformTestCase() {

    private lateinit var scope: CoroutineScope

    override fun setUp() {
        super.setUp()
        scope = CoroutineScope(SupervisorJob())
    }

    override fun tearDown() {
        try {
            scope.cancel()
        } finally {
            super.tearDown()
        }
    }

    fun `test workspace disposes when parent disposed`() = runBlocking {
        val rpc = Rpc()
        val service = KiloWorkspaceService(scope, rpc)
        val parent = Disposer.newDisposable("workspace")
        val workspace = service.workspace("/test", parent)

        assertEquals(1, service.cachedWorkspaces())
        val job = launch { workspace.state.collect { } }
        rpc.started.await()

        Disposer.dispose(parent)

        withTimeout(1_000) { rpc.cancelled.await() }
        assertEquals(0, service.cachedWorkspaces())
        job.cancel()
    }

    private class Rpc : KiloWorkspaceRpcApi {
        val started = CompletableDeferred<Unit>()
        val cancelled = CompletableDeferred<Unit>()

        override suspend fun resolveProjectDirectory(hint: String): String = hint

        override suspend fun state(directory: String): Flow<KiloWorkspaceStateDto> = flow {
            started.complete(Unit)
            try {
                emit(KiloWorkspaceStateDto(KiloWorkspaceStatusDto.PENDING))
                awaitCancellation()
            } finally {
                cancelled.complete(Unit)
            }
        }

        override suspend fun reload(directory: String) = Unit
    }
}
