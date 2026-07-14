package ai.kilocode.client.session.ui.prompt

import ai.kilocode.client.app.KiloWorkspaceService
import ai.kilocode.client.app.KiloFileSearchSettingsService
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.testing.FakeWorkspaceRpcApi
import ai.kilocode.rpc.dto.CommandDto
import ai.kilocode.rpc.dto.FileSearchBackendDto
import ai.kilocode.rpc.dto.FileSearchResultDto
import ai.kilocode.rpc.dto.KiloWorkspaceStateDto
import ai.kilocode.rpc.dto.KiloWorkspaceStatusDto
import ai.kilocode.rpc.dto.WorkspaceFileDto
import com.intellij.codeInsight.lookup.LookupElementPresentation
import com.intellij.icons.AllIcons
import com.intellij.openapi.fileTypes.FileTypeManager
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.util.textCompletion.TextCompletionUtil
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel

@Suppress("UnstableApiUsage")
class KiloPromptCompletionProviderTest : BasePlatformTestCase() {
    private lateinit var scope: CoroutineScope
    private lateinit var rpc: FakeWorkspaceRpcApi
    private lateinit var provider: KiloPromptCompletionProvider

    override fun setUp() {
        super.setUp()
        KiloFileSearchSettingsService.getInstance().loadState(KiloFileSearchSettingsService.State())
        scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        rpc = FakeWorkspaceRpcApi()
        val workspaces = KiloWorkspaceService(scope, rpc)
        provider = KiloPromptCompletionProvider(
            workspace = workspaces.workspace("/test"),
            service = workspaces,
            actions = listOf(
                SlashAction(SlashAction.NEW.name, "New", listOf("clear")) {},
                SlashAction("sessions", "Sessions", listOf("continue")) {},
                SlashAction("next", "Next") {},
            ),
            mentions = listOf(MentionAction(
                MentionAction.GIT_CHANGES.name,
                "Git Changes",
                available = MentionAction.GIT_CHANGES.available,
            )),
            scope = scope,
        )
    }

    override fun tearDown() {
        try {
            KiloFileSearchSettingsService.getInstance().loadState(KiloFileSearchSettingsService.State())
            scope.cancel()
        } finally {
            super.tearDown()
        }
    }

    fun `test mention completion shows backend fuzzy results without local filtering`() {
        rpc.searchResult = FileSearchResultDto(files = listOf(file("src/foo/Bar.kt")))

        complete("@sfb<caret>")

        assertContainsElements(myFixture.lookupElementStrings.orEmpty(), "src/foo/Bar.kt")
        assertFalse(myFixture.lookupElementStrings.orEmpty().contains(noMatches()))
        assertEquals(listOf("sfb"), rpc.searchQueries)
    }

    fun `test mention completion opens in middle of token`() {
        rpc.searchResult = FileSearchResultDto(files = listOf(file("src/deploy.ts")))

        complete("@dep<caret>loy")

        assertContainsElements(myFixture.lookupElementStrings.orEmpty(), "src/deploy.ts")
        assertEquals(listOf("dep"), rpc.searchQueries)
    }

    fun `test slash completion opens in middle of token`() {
        complete("/ne<caret>w")

        assertContainsElements(myFixture.lookupElementStrings.orEmpty(), "new")
        assertFalse(myFixture.lookupElementStrings.orEmpty().contains(noMatches()))
    }

    fun `test mention completion reuses identical prefix result`() {
        rpc.searchResult = FileSearchResultDto(files = listOf(file("src/Main.kt")))

        complete("@main<caret>")
        complete("@main<caret>")

        assertEquals(listOf("main"), rpc.searchQueries)
    }

    fun `test mention completion refetches same prefix after backend changes`() {
        rpc.search = { query -> FileSearchResultDto(files = listOf(file("kilo/$query.kt"))) }

        complete("@main<caret>")
        KiloFileSearchSettingsService.getInstance().setBackend(FileSearchBackendDto.INTELLIJ)
        complete("@main<caret>")

        assertEquals(listOf("main", "main"), rpc.searchQueries)
        assertEquals(listOf(FileSearchBackendDto.KILO, FileSearchBackendDto.INTELLIJ), rpc.searchBackends)
    }

    fun `test clearing mentions resets cached prefix result`() {
        rpc.searchResult = FileSearchResultDto(files = listOf(file("src/Main.kt")))

        complete("@main<caret>")
        provider.clearMentions()
        complete("@main<caret>")

        assertEquals(listOf("main", "main"), rpc.searchQueries)
    }

    fun `test mention completion includes matching special items`() {
        rpc.searchResult = FileSearchResultDto(git = true)

        complete("@git<caret>")

        assertContainsElements(myFixture.lookupElementStrings.orEmpty(), MentionAction.GIT_CHANGES.name)
        assertEquals(listOf("git"), rpc.searchQueries)
    }

    fun `test mention completion keeps no-match placeholder`() {
        rpc.searchResult = FileSearchResultDto()

        complete("@zzz<caret>")

        assertContainsElements(myFixture.lookupElementStrings.orEmpty(), noMatches())
        assertFalse(myFixture.lookupElementStrings.orEmpty().contains("src/foo/Bar.kt"))
        assertEquals(listOf("zzz"), rpc.searchQueries)
    }

    fun `test accepting mention no-match placeholder preserves prefix`() {
        rpc.searchResult = FileSearchResultDto()

        complete("@zzz<caret>")
        myFixture.type('\n')

        assertEquals("@zzz", myFixture.editor.document.text)
        assertNull(provider.mentionAt("@zzz", 1))
    }

    fun `test accepting mention mid token replaces glued suffix`() {
        rpc.searchResult = FileSearchResultDto(files = listOf(file("backend/deploy-dev.sh")))

        complete("@backend/deploy<caret>-dev.sh")
        myFixture.type('\n')

        assertEquals("@backend/deploy-dev.sh ", myFixture.editor.document.text)
        assertEquals(
            KiloPromptCompletionProvider.MentionHit(0, 22, "backend/deploy-dev.sh", true),
            provider.mentionAt(myFixture.editor.document.text, 1),
        )
    }

    fun `test accepting mention mid token trims before trailing content`() {
        rpc.searchResult = FileSearchResultDto(files = listOf(file("backend/deploy-dev.sh")))

        complete("@backend/deploy<caret>-dev.sh tail")
        myFixture.type('\n')

        assertEquals("@backend/deploy-dev.sh tail", myFixture.editor.document.text)
        assertEquals(
            KiloPromptCompletionProvider.MentionHit(0, 22, "backend/deploy-dev.sh", true),
            provider.mentionAt(myFixture.editor.document.text, 1),
        )
    }

    fun `test slash completion keeps no-match placeholder`() {
        complete("/zzz<caret>")

        assertContainsElements(myFixture.lookupElementStrings.orEmpty(), noMatches())
    }

    fun `test slash completion hides placeholder for real matches`() {
        complete("/ne<caret>")

        assertContainsElements(myFixture.lookupElementStrings.orEmpty(), "new")
        assertFalse(myFixture.lookupElementStrings.orEmpty().contains(noMatches()))
    }

    fun `test slash completion matches client aliases`() {
        complete("/cle<caret>")

        assertContainsElements(myFixture.lookupElementStrings.orEmpty(), "new")
        assertFalse(myFixture.lookupElementStrings.orEmpty().contains(noMatches()))
    }

    fun `test blank mention completion includes special and root entries`() {
        rpc.searchResult = FileSearchResultDto(
            files = listOf(file("src", directory = true), file("README.md")),
            git = true,
        )

        complete("@<caret>")

        assertContainsElements(myFixture.lookupElementStrings.orEmpty(), MentionAction.GIT_CHANGES.name, "src", "README.md")
        val items = myFixture.lookupElementStrings.orEmpty()
        assertEquals(MentionAction.GIT_CHANGES.name, items.first())
        assertEquals(listOf(""), rpc.searchQueries)
    }

    fun `test prewarm serves blank mention completion from cache`() {
        rpc.searchResult = FileSearchResultDto(
            files = listOf(file("src", directory = true), file("README.md")),
            git = true,
        )

        provider.prewarm()
        waitFor { rpc.searchQueries.contains("") }
        complete("@<caret>")

        assertContainsElements(myFixture.lookupElementStrings.orEmpty(), MentionAction.GIT_CHANGES.name, "src", "README.md")
        assertEquals(listOf(""), rpc.searchQueries)
    }

    fun `test mention completion renders file type icons`() {
        rpc.searchResult = FileSearchResultDto(files = listOf(file("image.png"), file("src", directory = true)))

        complete("@<caret>")

        assertEquals(FileTypeManager.getInstance().getFileTypeByFileName("image.png").icon ?: AllIcons.FileTypes.Text, icon("image.png"))
        assertSame(AllIcons.Nodes.Folder, icon("src"))
    }

    fun `test highlights known slash command at start`() {
        assertEquals(
            listOf(KiloPromptCompletionProvider.Highlight(0, 4, KiloPromptCompletionProvider.HighlightKind.COMMAND)),
            provider.highlights("/new start fresh"),
        )
    }

    fun `test highlights client slash command aliases at start`() {
        assertEquals(
            listOf(KiloPromptCompletionProvider.Highlight(0, 6, KiloPromptCompletionProvider.HighlightKind.COMMAND)),
            provider.highlights("/clear"),
        )
    }

    fun `test highlights server slash command at start`() {
        rpc.state.value = KiloWorkspaceStateDto(KiloWorkspaceStatusDto.READY, commands = listOf(CommandDto("deploy")))

        waitFor { provider.highlights("/deploy prod").isNotEmpty() }

        assertEquals(
            listOf(KiloPromptCompletionProvider.Highlight(0, 7, KiloPromptCompletionProvider.HighlightKind.COMMAND)),
            provider.highlights("/deploy prod"),
        )
    }

    fun `test highlights ignore unknown and non-leading slash commands`() {
        assertTrue(provider.highlights("/bogus now").isEmpty())
        assertTrue(provider.highlights("hi /new").isEmpty())
    }

    fun `test highlights special mentions without tracked paths`() {
        assertEquals(
            listOf(
                KiloPromptCompletionProvider.Highlight(4, 16, KiloPromptCompletionProvider.HighlightKind.MENTION),
            ),
            provider.highlights("use ${MentionAction.GIT_CHANGES.token}").sortedBy { it.start },
        )
    }

    fun `test serverCommand routes only known server commands`() {
        rpc.state.value = KiloWorkspaceStateDto(KiloWorkspaceStatusDto.READY, commands = listOf(CommandDto("deploy")))

        waitFor { provider.serverCommand("/deploy x") != null }

        assertEquals("deploy" to "x", provider.serverCommand("/deploy x"))
        assertNull(provider.serverCommand("/new"))
        assertNull(provider.serverCommand("hi /deploy"))
        assertNull(provider.serverCommand("/unknown"))
    }

    fun `test clientAction resolves canonical names and aliases`() {
        assertEquals(SlashAction.NEW.name, provider.clientAction("/new")?.name)
        assertEquals(SlashAction.NEW.name, provider.clientAction("/clear")?.name)
        assertEquals("sessions", provider.clientAction("/continue")?.name)
        assertNull(provider.clientAction("hi /clear"))
    }

    fun `test serverCommand does not route client aliases`() {
        rpc.state.value = KiloWorkspaceStateDto(KiloWorkspaceStatusDto.READY, commands = listOf(CommandDto("clear")))

        assertNull(provider.serverCommand("/clear"))
    }

    fun `test highlights tracked mentions longest first`() {
        addMention("src/a.ts", "@ts")
        addMention("src/a.tsx", "@tsx")

        assertEquals(
            listOf(KiloPromptCompletionProvider.Highlight(4, 14, KiloPromptCompletionProvider.HighlightKind.MENTION)),
            provider.highlights("see @src/a.tsx"),
        )
    }

    fun `test highlights unknown mentions are pending before validation`() {
        assertTrue(provider.highlights("see @unknownPath").isEmpty())
    }

    fun `test highlights unresolved mention after validation`() {
        var done = false
        rpc.fileResolver = { emptyList() }

        provider.validate("see @unknownPath", -1) { done = true }
        waitFor { done }

        assertEquals(
            listOf(KiloPromptCompletionProvider.Highlight(4, 16, KiloPromptCompletionProvider.HighlightKind.INVALID)),
            provider.highlights("see @unknownPath", -1),
        )
    }

    fun `test highlights existing hand typed mention after validation`() {
        var done = false
        rpc.fileResolver = { path -> if (path == "src/x.kt") listOf(file(path)) else emptyList() }

        provider.validate("see @src/x.kt", -1) { done = true }
        waitFor { done }

        assertEquals(
            listOf(KiloPromptCompletionProvider.Highlight(4, 13, KiloPromptCompletionProvider.HighlightKind.MENTION)),
            provider.highlights("see @src/x.kt", -1),
        )
    }

    fun `test mention under caret is not flagged`() {
        assertTrue(provider.highlights("@nope", caret = 5).isEmpty())
    }

    fun `test mentionAt resolves tracked file mention`() {
        addMention("src/a.ts", "@ts")

        assertEquals(
            KiloPromptCompletionProvider.MentionHit(4, 13, "src/a.ts", true),
            provider.mentionAt("see @src/a.ts", 6),
        )
    }

    fun `test mentionAt marks unresolved file mention after validation`() {
        var done = false
        rpc.fileResolver = { emptyList() }

        provider.validate("see @missing.ts", -1) { done = true }
        waitFor { done }

        assertEquals(
            KiloPromptCompletionProvider.MentionHit(4, 15, "missing.ts", false),
            provider.mentionAt("see @missing.ts", 6),
        )
    }

    fun `test mentionAt ignores special pending and out of range`() {
        assertNull(provider.mentionAt("use ${MentionAction.GIT_CHANGES.token}", 6))
        assertNull(provider.mentionAt("see @unvalidated.ts", 6))
        assertNull(provider.mentionAt("hello world", 3))
    }

    fun `test navigate opens resolved mention file`() {
        rpc.fileResolver = { path -> if (path == "src/a.ts") listOf(file(path)) else emptyList() }

        provider.navigate("src/a.ts")
        waitFor { rpc.opened.contains("src/a.ts") }

        assertTrue(rpc.opened.contains("src/a.ts"))
    }

    private fun complete(text: String) {
        val file = myFixture.configureByText("prompt.txt", text)
        TextCompletionUtil.installProvider(file, provider, true)
        myFixture.completeBasic()
    }

    private fun addMention(path: String, query: String) {
        rpc.searchResult = FileSearchResultDto(files = listOf(file(path)))
        complete("$query<caret>")
        myFixture.type('\n')
        assertEquals(path, provider.mentionAt("@$path", 1)?.value)
    }

    private fun waitFor(done: () -> Boolean) {
        repeat(50) {
            com.intellij.util.ui.UIUtil.dispatchAllInvocationEvents()
            if (done()) return
            Thread.sleep(20)
        }
    }

    private fun icon(value: String) = LookupElementPresentation().also { item(value).renderElement(it) }.icon

    private fun item(value: String) = myFixture.lookupElements.orEmpty().first { it.lookupString == value }

    private fun file(path: String, directory: Boolean = false) = WorkspaceFileDto(
        path = path,
        name = path.substringAfterLast('/'),
        directory = directory,
    )

    private fun noMatches() = KiloBundle.message("prompt.completion.noMatches")
}
