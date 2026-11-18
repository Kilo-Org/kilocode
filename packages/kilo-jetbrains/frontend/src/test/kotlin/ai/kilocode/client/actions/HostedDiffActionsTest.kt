package ai.kilocode.client.actions

import ai.kilocode.client.agentManager.hosted.HostedPullRequestService
import ai.kilocode.client.agentManager.hosted.HostedWorkspaceDataKeys
import ai.kilocode.client.agentManager.hosted.HostedWorkspaceEditorKind
import ai.kilocode.client.app.KiloHostedService
import ai.kilocode.client.diff.HostedDiffComparison
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.testing.PluginDescriptor
import ai.kilocode.client.testing.TestCoroutines
import ai.kilocode.client.testing.TestLog
import ai.kilocode.client.testing.attribute
import ai.kilocode.client.testing.elements
import ai.kilocode.client.util.edtWait
import ai.kilocode.rpc.dto.HostedPullRequestChecksDto
import ai.kilocode.rpc.dto.HostedPullRequestConversationsDto
import ai.kilocode.rpc.dto.HostedPullRequestMergeabilityDto
import ai.kilocode.rpc.dto.HostedPullRequestReviewDto
import ai.kilocode.rpc.dto.HostedPullRequestSummaryDto
import ai.kilocode.rpc.dto.HostedWorkspaceDto
import ai.kilocode.rpc.dto.HostedWorkspacePullRequestDto
import ai.kilocode.rpc.dto.HostedWorkspaceRefDto
import com.intellij.openapi.actionSystem.ActionPlaces
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.CommonDataKeys
import com.intellij.openapi.actionSystem.DataContext
import com.intellij.openapi.actionSystem.Presentation
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.testFramework.replaceService
import org.w3c.dom.Element

class HostedDiffActionsTest : BasePlatformTestCase() {
    private val ref = HostedWorkspaceRefDto("cloud", "workspace")
    private val dto = HostedWorkspaceDto(ref)
    private val actions = listOf(HostedCommittedDiffAction(), HostedUncommittedDiffAction(), HostedPullRequestDiffAction())
    private lateinit var coroutines: TestCoroutines
    private lateinit var pulls: HostedPullRequestService
    private var enabled = true
    private var result: HostedWorkspacePullRequestDto? = null

    override fun setUp() {
        super.setUp()
        coroutines = TestCoroutines()
        project.replaceService(KiloHostedService::class.java,
            KiloHostedService(coroutines.scope, null, gate = { enabled }, log = TestLog()), testRootDisposable)
        pulls = HostedPullRequestService(
            coroutines.scope,
            read = { result ?: HostedWorkspacePullRequestDto(it, "no_pr", null) },
            revalidate = { result ?: HostedWorkspacePullRequestDto(it, "no_pr", null) },
            pause = { kotlinx.coroutines.delay(Long.MAX_VALUE) },
            clock = { 100_000L },
            identity = null,
            signedOut = null,
        )
        project.replaceService(HostedPullRequestService::class.java, pulls, testRootDisposable)
    }

    override fun tearDown() {
        try {
            coroutines.close()
        } finally {
            super.tearDown()
        }
    }

    fun testWorkspaceComparisonsAreAvailableWithoutComputeOrALinkedPullRequest() {
        assertEquals(listOf(HostedDiffComparison.COMMITTED, HostedDiffComparison.UNCOMMITTED, HostedDiffComparison.PULL_REQUEST),
            actions.map { it.comparison })
        edtWait {
            assertTrue(visible(actions[0]))
            assertTrue(visible(actions[1]))
            assertFalse(visible(actions[2]))
        }
    }

    fun testLocalMissingPendingAndDeletedRowsHaveNoHostedDiffActions() {
        edtWait {
            actions.forEach { action ->
                assertFalse(visible(action, event(workspace = null)))
                assertFalse(visible(action, event(project = false)))
                assertFalse(visible(action, event(dto.copy(ref = ref.copy(workspaceID = "${HostedWorkspaceEditorKind.PENDING_PREFIX}one")))))
                assertFalse(visible(action, event(dto.copy(deletionState = "deleted"))))
                assertFalse(visible(action, event(dto.copy(deletionState = "deleting"))))
            }
        }
    }

    fun testDisabledCloudGateRejectsStaleClicksAsWellAsHidingActions() {
        enabled = false
        edtWait {
            actions.forEach { action ->
                val event = event()
                assertFalse(visible(action, event))
                action.actionPerformed(event)
            }
        }
    }

    fun testPublishedComparisonRequiresTheSameWorkspaceLinkedPullRequest() {
        result = HostedWorkspacePullRequestDto(ref, "available", HostedPullRequestSummaryDto(
            "https://github.com/owner/repo/pull/42", 42, "open", "Cloud change", "a".repeat(40), "2026-11-17T00:00:00Z",
            HostedPullRequestReviewDto("approved", true, false),
            HostedPullRequestChecksDto(1, 1, 0, 0, 0, 0, true, true),
            HostedPullRequestConversationsDto(0, true),
            HostedPullRequestMergeabilityDto(true, "clean", true), false, emptyList(),
        ))
        pulls.refresh(ref, revalidate = true)
        assertTrue(coroutines.pumpUntil { pulls.pulls.value[ref.key] != null })
        edtWait {
            assertTrue(visible(actions[2]))
            assertFalse(visible(actions[2], event(dto.copy(ref = ref.copy(workspaceID = "sibling-workspace")))))
        }
        pulls.clear()
        edtWait { assertFalse(visible(actions[2])) }
    }

    fun testHeaderKeepsLocalizedComparisonActionsOutsideTheCommonRowMenu() {
        val descriptor = PluginDescriptor.frontend()
        val ids = listOf("CommittedDiff", "UncommittedDiff", "PullRequestDiff").map { "Kilo.HostedWorkspace.$it" }
        ids.zip(actions).forEach { (id, action) ->
            val declared = descriptor.elements("action").single { it.attribute("id") == id }
            assertEquals(action.javaClass.name, declared.attribute("class"))
            assertNull(declared.attribute("text"))
            assertFalse(KiloBundle.optional("action.$id.text").isNullOrBlank())
            assertFalse(KiloBundle.optional("action.$id.description").isNullOrBlank())
            assertTrue(descriptor.elements("reference").any {
                it.attribute("ref") == id && (it.parentNode as? Element)?.attribute("id") == "Kilo.HostedWorkspace.Comparisons"
            })
            assertFalse(descriptor.elements("reference").any {
                it.attribute("ref") == id && (it.parentNode as? Element)?.attribute("id") == "Kilo.Worktree.RowMenu"
            })
        }
        val menu = descriptor.elements("group").single { it.attribute("id") == "Kilo.HostedWorkspace.Comparisons" }
        val order = (0 until menu.childNodes.length).mapNotNull { menu.childNodes.item(it) as? Element }.map {
            it.attribute("ref")
        }
        assertEquals(ids, order)
    }

    private fun visible(action: HostedDiffAction, event: AnActionEvent = event()): Boolean {
        action.update(event)
        assertEquals(event.presentation.isVisible, event.presentation.isEnabled)
        return event.presentation.isEnabledAndVisible
    }

    private fun event(workspace: HostedWorkspaceDto? = dto, project: Boolean = true): AnActionEvent =
        AnActionEvent.createFromDataContext(ActionPlaces.POPUP, Presentation(), DataContext { id ->
            when {
                CommonDataKeys.PROJECT.`is`(id) -> this.project.takeIf { project }
                HostedWorkspaceDataKeys.WORKSPACE.`is`(id) -> workspace
                else -> null
            }
        })
}
