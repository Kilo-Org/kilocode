package ai.kilocode.backend.run

import com.intellij.execution.BeforeRunTask
import com.intellij.execution.ExecutionListener
import com.intellij.execution.ExecutionManager
import com.intellij.execution.RunManager
import com.intellij.execution.RunnerAndConfigurationSettings
import com.intellij.execution.compound.CompoundRunConfiguration
import com.intellij.execution.compound.CompoundRunConfigurationType
import com.intellij.execution.configuration.EnvironmentVariablesData
import com.intellij.execution.configurations.runConfigurationType
import com.intellij.execution.process.ProcessHandler
import com.intellij.execution.runners.ExecutionEnvironment
import com.intellij.openapi.util.Key
import com.intellij.openapi.util.SystemInfo
import com.intellij.sh.run.ShConfigurationType
import com.intellij.sh.run.ShRunConfiguration
import com.intellij.testFramework.PlatformTestUtil
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking
import org.junit.Assume.assumeFalse
import java.nio.file.Files
import java.nio.file.Path
import java.util.concurrent.CompletableFuture

class WorktreeRunShellTest : BasePlatformTestCase() {
    private companion object {
        const val TIMEOUT_SECONDS = 30
    }

    private val manager get() = RunManager.getInstance(project)
    private val repo get() = Path.of(requireNotNull(project.basePath))
    private val worktree get() = repo.resolve(".kilo/worktrees/topic")

    fun testFileRunRebasesPathsAndPreservesSource() {
        val vars = mapOf("CUSTOM" to "keep me", "WORKTREE_PATH" to "replace me")
        val settings = shell {
            scriptWorkingDirectory = repo.resolve("package").toString()
            scriptPath = "\$PROJECT_DIR\$/package/run script.sh"
            interpreterPath = repo.resolve("tools/shell").toString()
            scriptOptions = "--script-option"
            interpreterOptions = "--interpreter-option"
            envData = EnvironmentVariablesData.create(vars, false)
        }
        val source = settings.configuration as ShRunConfiguration
        val result = clone(settings)
        val clone = result.configuration as ShRunConfiguration

        assertNotSame(source, clone)
        assertEquals("Shell [topic]", clone.name)
        assertTrue(result.isActivateToolWindowBeforeRun)
        assertTrue(clone.isExecuteScriptFile)
        assertFalse(clone.isExecuteInTerminal)
        assertEquals(worktree.resolve("package"), Path.of(clone.scriptWorkingDirectory))
        assertEquals(worktree.resolve("package/run script.sh"), Path.of(clone.scriptPath))
        assertEquals(worktree.resolve("tools/shell"), Path.of(clone.interpreterPath))
        assertEquals("--script-option", clone.scriptOptions)
        assertEquals("--interpreter-option", clone.interpreterOptions)
        assertEquals("keep me", clone.envData.envs["CUSTOM"])
        assertEquals(worktree.toString(), clone.envData.envs["WORKTREE_PATH"])
        assertEquals(repo.toString(), clone.envData.envs["REPO_PATH"])
        assertFalse(clone.envData.isPassParentEnvs)

        assertEquals("Shell", source.name)
        assertTrue(source.isExecuteInTerminal)
        assertEquals(repo.resolve("package"), Path.of(source.scriptWorkingDirectory))
        assertEquals("\$PROJECT_DIR\$/package/run script.sh", source.scriptPath)
        assertEquals(repo.resolve("tools/shell"), Path.of(source.interpreterPath))
        assertEquals(vars, source.envData.envs)
    }

    fun testFileRunLeavesAnExternalInterpreterAlone() {
        val path = requireNotNull(repo.parent).resolve("external-shell").toString()
        val settings = shell {
            scriptPath = "run.sh"
            interpreterPath = path
        }
        val clone = clone(settings).configuration as ShRunConfiguration

        assertEquals(worktree, Path.of(clone.scriptWorkingDirectory))
        assertEquals(worktree.resolve("run.sh"), Path.of(clone.scriptPath))
        assertEquals(path, clone.interpreterPath)
    }

    fun testTemplateBeforeRunTasksAreNotReattachedToShellClone() {
        val settings = shell { scriptPath = "run.sh" }
        val template = manager.getConfigurationTemplate(settings.factory).configuration
        val tasks = template.beforeRunTasks
        val task = Task().apply { isEnabled = true }
        template.beforeRunTasks = tasks + task
        try {
            assertTrue(clone(settings).configuration.beforeRunTasks.isEmpty())
            assertTrue(template.beforeRunTasks.contains(task))
        } finally {
            template.beforeRunTasks = tasks
        }
    }

    fun testInlineRunKeepsCommandTextAndInactiveFileFields() {
        val text = "printf '%s\\n' '$repo'\nprintf '%s\\n' \"\$VALUE\""
        val settings = shell {
            isExecuteScriptFile = false
            scriptWorkingDirectory = ""
            scriptText = text
            scriptPath = repo.resolve("inactive.sh").toString()
            interpreterPath = repo.resolve("tools/shell").toString()
            envData = EnvironmentVariablesData.create(mapOf("VALUE" to "keep me"), true)
        }
        val source = settings.configuration as ShRunConfiguration
        val clone = clone(settings).configuration as ShRunConfiguration

        assertFalse(clone.isExecuteScriptFile)
        assertFalse(clone.isExecuteInTerminal)
        assertEquals(worktree, Path.of(clone.scriptWorkingDirectory))
        assertEquals(text, clone.scriptText)
        assertEquals(source.scriptPath, clone.scriptPath)
        assertEquals(source.interpreterPath, clone.interpreterPath)
        // The clone stores the original environment even though the pinned Run runner ignores it.
        assertEquals("keep me", clone.envData.envs["VALUE"])
        assertTrue(source.isExecuteInTerminal)
        assertEquals("", source.scriptWorkingDirectory)
        assertEquals(text, source.scriptText)
    }

    fun testCompoundRunsInlineCommandsAndScriptFileFromWorktree() {
        assumeFalse(SystemInfo.isWindows)
        val dir = Files.createDirectories(worktree)
        val script = Files.writeString(dir.resolve("script.sh"), "pwd > Script.cwd\nprintf '%s' \"\$WORKTREE_PATH\" > Script.env\n")
        val inline = listOf("Cloud", "Web").map { name ->
            shell(name) {
                isExecuteScriptFile = false
                scriptWorkingDirectory = "\$PROJECT_DIR\$"
                scriptText = "pwd > $name.cwd"
            }
        }
        val children = inline + shell("Script") {
            scriptPath = repo.resolve(script.fileName).toString()
            interpreterPath = "/bin/sh"
        }
        children.forEach(manager::addConfiguration)
        val group = manager.createConfiguration("Cloud + Web", runConfigurationType<CompoundRunConfigurationType>())
        (group.configuration as CompoundRunConfiguration).setConfigurationsWithoutTargets(children.map { it.configuration })
        manager.addConfiguration(group)

        val done = children.associate { "${it.name} [topic]" to CompletableFuture<Int>() }
        project.messageBus.connect(testRootDisposable).subscribe(ExecutionManager.EXECUTION_TOPIC, object : ExecutionListener {
            override fun processTerminated(executorId: String, env: ExecutionEnvironment, handler: ProcessHandler, exitCode: Int) {
                done[env.runProfile.name]?.complete(exitCode)
            }
        })

        val cs = CoroutineScope(Dispatchers.Default)
        try {
            val runner = WorktreeRunManager(project, cs)
            val result = PlatformTestUtil.callOnBgtSynchronously(
                { runBlocking { runner.run(group.uniqueID, dir.toString()) } },
                TIMEOUT_SECONDS,
            )
            assertTrue(result?.error, result?.ok == true)
            for ((name, exit) in done) {
                assertEquals(name, 0, PlatformTestUtil.waitForFuture(exit, TIMEOUT_SECONDS * 1_000L))
            }
            for (child in children) {
                val marker = "${child.name}.cwd"
                assertFalse(Files.exists(repo.resolve(marker)))
                assertEquals(dir.toRealPath(), Path.of(Files.readString(dir.resolve(marker)).trim()).toRealPath())
            }
            assertEquals(dir.toString(), Files.readString(dir.resolve("Script.env")))
        } finally {
            cs.cancel()
            manager.removeConfiguration(group)
            children.forEach(manager::removeConfiguration)
        }
    }

    private fun shell(name: String = "Shell", init: ShRunConfiguration.() -> Unit): RunnerAndConfigurationSettings {
        val settings = manager.createConfiguration(name, ShConfigurationType.getInstance())
        (settings.configuration as ShRunConfiguration).apply {
            scriptWorkingDirectory = repo.toString()
            isExecuteInTerminal = true
            init()
        }
        return settings
    }

    private fun clone(settings: RunnerAndConfigurationSettings): RunnerAndConfigurationSettings {
        assertTrue(WorktreeRunAdapter.supports(settings.configuration))
        return requireNotNull(WorktreeRunAdapter.transplant(manager, settings, worktree.toString(), repo.toString(), "topic"))
    }

    private class Task : BeforeRunTask<Task>(Key.create("kilo.test.shell.before"))
}
