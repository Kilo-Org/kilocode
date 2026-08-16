package ai.kilocode.client.session.controller

import ai.kilocode.rpc.dto.EditorContextDto
import ai.kilocode.rpc.dto.PromptPartDto
import kotlin.test.assertEquals

class EditorContextPromptTest : SessionControllerTestBase() {
    fun `test prompt forwards editor context`() {
        val (c, _, _) = prompted()
        rpc.prompts.clear()
        val ctx = EditorContextDto(
            activeFile = "src/App.kt",
            openTabs = listOf("src/App.kt"),
            visibleFiles = listOf("src/App.kt"),
        )
        val file = PromptPartDto(
            type = "file",
            mime = "text/plain",
            url = "file:///test/src/App.kt?start=2&end=3",
            filename = "App.kt",
        )

        edt { c.prompt("explain", listOf(file), ctx) }
        flush()

        val prompt = rpc.prompts.single().third
        assertEquals(ctx, prompt.editorContext)
        assertEquals(file, prompt.parts.first { it.type == "file" })
    }
}
