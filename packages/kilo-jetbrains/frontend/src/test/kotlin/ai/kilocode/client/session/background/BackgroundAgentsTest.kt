package ai.kilocode.client.session.background

import ai.kilocode.rpc.dto.BackgroundJobDto
import junit.framework.TestCase

class BackgroundAgentsTest : TestCase() {

    fun `test rows only keeps background task jobs owned by the parent`() {
        val jobs = listOf(
            job("job1", type = "task", parent = "ses_parent", background = true, sessionId = "ses_child1"),
            job("job2", type = "task", parent = "ses_parent", background = false, sessionId = "ses_child2"),
            job("job3", type = "task", parent = "ses_other", background = true, sessionId = "ses_child3"),
            job("job4", type = "shell", parent = "ses_parent", background = true, sessionId = "ses_child4"),
        )

        val rows = BackgroundAgents.rows(jobs, "ses_parent")

        assertEquals(listOf("job1"), rows.map { it.job })
    }

    fun `test rows falls back to job id when sessionId is missing`() {
        val jobs = listOf(job("ses_child1", type = "task", parent = "ses_parent", background = true, sessionId = null))

        val rows = BackgroundAgents.rows(jobs, "ses_parent")

        assertEquals("ses_child1", rows.single().session)
    }

    fun `test rows marks waiting when the child session has a pending permission`() {
        val jobs = listOf(job("job1", type = "task", parent = "ses_parent", background = true, sessionId = "ses_child1"))

        val waiting = BackgroundAgents.rows(jobs, "ses_parent", waiting = setOf("ses_child1")).single()
        val notWaiting = BackgroundAgents.rows(jobs, "ses_parent", waiting = emptySet()).single()

        assertTrue(waiting.waiting)
        assertFalse(notWaiting.waiting)
    }

    fun `test rows maps every status`() {
        val jobs = listOf(
            job("running", status = "running"),
            job("completed", status = "completed"),
            job("cancelled", status = "cancelled"),
            job("error", status = "error"),
        )

        val rows = BackgroundAgents.rows(jobs, "ses_parent").associateBy { it.job }

        assertEquals(BackgroundAgentStatus.RUNNING, rows["running"]!!.status)
        assertEquals(BackgroundAgentStatus.COMPLETED, rows["completed"]!!.status)
        assertEquals(BackgroundAgentStatus.CANCELLED, rows["cancelled"]!!.status)
        assertEquals(BackgroundAgentStatus.ERROR, rows["error"]!!.status)
    }

    fun `test visible keeps a running agent even if dismissed`() {
        val agent = agent("job1", status = BackgroundAgentStatus.RUNNING)

        assertTrue(BackgroundAgents.visible(agent, dismissed = setOf("job1")))
    }

    fun `test visible hides a finished agent once dismissed`() {
        val agent = agent("job1", status = BackgroundAgentStatus.COMPLETED)

        assertTrue(BackgroundAgents.visible(agent, dismissed = emptySet()))
        assertFalse(BackgroundAgents.visible(agent, dismissed = setOf("job1")))
    }

    fun `test visible shows a dismissed job again once it is running`() {
        // Same job id running again after a previous dismissal — dismissal is not durable.
        val agent = agent("job1", status = BackgroundAgentStatus.RUNNING)

        assertTrue(BackgroundAgents.visible(agent, dismissed = setOf("job1")))
    }

    fun `test order puts running and waiting agents first, stable within each group`() {
        val done = agent("done1", status = BackgroundAgentStatus.COMPLETED)
        val running = agent("running1", status = BackgroundAgentStatus.RUNNING)
        val waitingFinished = agent("waiting1", status = BackgroundAgentStatus.ERROR, waiting = true)
        val other = agent("done2", status = BackgroundAgentStatus.CANCELLED)

        val ordered = BackgroundAgents.order(listOf(done, running, waitingFinished, other))

        assertEquals(listOf("running1", "waiting1", "done1", "done2"), ordered.map { it.job })
    }

    private fun job(
        id: String,
        type: String = "task",
        status: String = "running",
        parent: String = "ses_parent",
        background: Boolean = true,
        sessionId: String? = "${id}_session",
    ) = BackgroundJobDto(
        id = id,
        type = type,
        status = status,
        parentSessionId = parent,
        background = background,
        sessionId = sessionId,
    )

    private fun agent(job: String, status: BackgroundAgentStatus, waiting: Boolean = false) =
        BackgroundAgent(job = job, session = "${job}_session", title = null, status = status, waiting = waiting)
}
