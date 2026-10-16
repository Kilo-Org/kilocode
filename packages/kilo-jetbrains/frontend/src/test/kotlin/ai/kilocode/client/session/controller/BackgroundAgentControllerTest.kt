package ai.kilocode.client.session.controller

import ai.kilocode.client.session.background.BackgroundAgentStatus
import ai.kilocode.rpc.dto.BackgroundJobDto
import ai.kilocode.rpc.dto.ChatEventDto
import ai.kilocode.rpc.dto.PartDto
import ai.kilocode.rpc.dto.PermissionRequestDto
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.runBlocking

class BackgroundAgentControllerTest : SessionControllerTestBase() {

    fun `test background jobs list populates model agents`() {
        val (m, _, _) = prompted()

        pushJobs("ses_test", listOf(job("job1", "ses_child1")))
        waitFor { m.model.backgroundAgents.size == 1 }

        val agent = m.model.backgroundAgents.single()
        assertEquals("job1", agent.job)
        assertEquals("ses_child1", agent.session)
        assertEquals(BackgroundAgentStatus.RUNNING, agent.status)
    }

    fun `test a job list for a different session does not populate this session`() {
        val (m, _, _) = prompted()

        pushJobs("ses_other", listOf(job("job1", "ses_child1", parent = "ses_other")))
        settle()

        assertTrue(m.model.backgroundAgents.isEmpty())
    }

    fun `test cancel background agent calls the CLI with the session directory`() {
        val (m, _, _) = prompted()

        edt { m.cancelBackgroundAgent("job1") }
        flush()

        assertEquals(listOf("job1" to "/test"), rpc.cancelledBackgroundJobs)
    }

    fun `test promote background agent calls the CLI and does not notify on success`() {
        val (m, _, _) = prompted()

        edt { m.promoteBackgroundAgent("ses_child1") }
        flush()

        assertEquals(listOf("ses_child1" to "/test"), rpc.promotedBackgroundJobs)
        assertTrue(infoNotifications.isEmpty())
    }

    fun `test promote failure surfaces an info notification`() {
        val (m, _, _) = prompted()
        rpc.promoteBackgroundJobResult = false

        edt { m.promoteBackgroundAgent("ses_child1") }
        flush()

        assertEquals(1, infoNotifications.size)
        assertTrue(notifications.isEmpty())
    }

    fun `test dismiss hides finished agents locally without calling the CLI`() {
        val (m, _, _) = prompted()
        pushJobs("ses_test", listOf(job("job1", "ses_child1", status = "completed")))
        waitFor { m.model.backgroundAgents.size == 1 }

        edt { m.dismissBackgroundAgents(setOf("job1")) }

        assertTrue(m.model.backgroundAgents.isEmpty())
        assertTrue(rpc.cancelledBackgroundJobs.isEmpty())
    }

    fun `test dismissing a running agent has no effect`() {
        val (m, _, _) = prompted()
        pushJobs("ses_test", listOf(job("job1", "ses_child1")))
        waitFor { m.model.backgroundAgents.size == 1 }

        edt { m.dismissBackgroundAgents(setOf("job1")) }

        assertEquals(1, m.model.backgroundAgents.size)
    }

    fun `test a pending child permission marks the agent as waiting without a new jobs emission`() {
        val (m, _, _) = prompted()
        pushJobs("ses_test", listOf(job("job1", "ses_child1")))
        waitFor { m.model.backgroundAgents.size == 1 }
        assertFalse(m.model.backgroundAgents.single().waiting)

        emit(taskPart("ses_child1"), flush = false)
        emit(ChatEventDto.PermissionAsked("ses_child1", childPermission("child_perm1")))

        assertTrue(m.model.backgroundAgents.single().waiting)

        emit(ChatEventDto.PermissionReplied("ses_child1", "child_perm1"))

        assertFalse(m.model.backgroundAgents.single().waiting)
    }

    fun `test clear resets background agents`() {
        val (m, _, _) = prompted()
        pushJobs("ses_test", listOf(job("job1", "ses_child1")))
        waitFor { m.model.backgroundAgents.size == 1 }

        edt { m.model.clear() }

        assertTrue(m.model.backgroundAgents.isEmpty())
    }

    private fun pushJobs(parent: String, jobs: List<BackgroundJobDto>) {
        runBlocking {
            rpc.backgroundJobsFlow.getOrPut(parent) { MutableSharedFlow(extraBufferCapacity = 8, replay = 1) }.emit(jobs)
        }
    }

    private fun job(id: String, childSession: String, parent: String = "ses_test", status: String = "running") = BackgroundJobDto(
        id = id,
        type = "task",
        status = status,
        parentSessionId = parent,
        background = true,
        sessionId = childSession,
    )

    private fun taskPart(child: String) = ChatEventDto.PartUpdated(
        sessionID = "ses_test",
        part = PartDto(
            id = "part_task",
            sessionID = "ses_test",
            messageID = "msg1",
            type = "tool",
            tool = "task",
            metadata = mapOf("sessionId" to child),
            input = mapOf("subagent_type" to "explore", "description" to "Find files"),
        ),
    )

    private fun childPermission(id: String) = PermissionRequestDto(
        id = id,
        sessionID = "ses_child1",
        permission = "edit",
        patterns = listOf("*.kt"),
        always = emptyList(),
    )
}
