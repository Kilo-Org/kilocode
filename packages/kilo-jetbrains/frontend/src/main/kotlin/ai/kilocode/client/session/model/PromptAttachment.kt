package ai.kilocode.client.session.model

import ai.kilocode.rpc.dto.PromptPartDto
import java.awt.Image
import java.awt.image.BufferedImage
import java.awt.image.MultiResolutionImage
import java.io.ByteArrayOutputStream
import java.util.Base64
import java.util.UUID
import javax.imageio.ImageIO
import java.nio.file.Path
import kotlin.io.path.name
import kotlin.io.path.readBytes

data class PromptAttachment(
    val id: String,
    val name: String,
    val mime: String,
    val url: String,
    val path: Path? = null,
) {
    fun part() = PromptPartDto(
        type = "file",
        mime = mime,
        url = path?.let { data(it, mime) } ?: url,
        filename = name,
    )
}

object PromptAttachmentExtractor {
    private const val MAX_BYTES = 10 * 1024 * 1024

    fun files(files: List<java.io.File>): List<PromptAttachment> = files
        .filter { it.exists() && it.isFile && it.canRead() && it.length() <= MAX_BYTES }
        .map { file ->
            val path = file.toPath()
            val mime = mime(file)
            if (!media(mime)) return@map null
            PromptAttachment(
                id = path.toAbsolutePath().normalize().toString(),
                name = path.fileName?.toString() ?: path.name,
                mime = mime,
                url = path.toUri().toString(),
                path = path,
            )
        }
        .filterNotNull()

    fun media(mime: String): Boolean = mime.startsWith("image/") || mime == "text/plain"

    fun image(raw: Any): PromptAttachment? {
        val image = when (raw) {
            is MultiResolutionImage -> raw.resolutionVariants.firstOrNull()?.buffered()
            is BufferedImage -> raw
            is Image -> raw.buffered()
            else -> null
        } ?: return null
        val out = ByteArrayOutputStream()
        ImageIO.write(image, "png", out)
        val id = UUID.randomUUID().toString()
        val data = Base64.getEncoder().encodeToString(out.toByteArray())
        return PromptAttachment(
            id = "clipboard-image:$id",
            name = "pasted-image-$id.png",
            mime = "image/png",
            url = "data:image/png;base64,$data",
        )
    }

    private fun mime(file: java.io.File): String {
        if (file.isDirectory) return "application/x-directory"
        return when (file.extension.lowercase()) {
            "png" -> "image/png"
            "jpg", "jpeg" -> "image/jpeg"
            "gif" -> "image/gif"
            "webp" -> "image/webp"
            "bmp" -> "image/bmp"
            "svg" -> "image/svg+xml"
            "pdf" -> "application/pdf"
            "txt", "md", "kt", "kts", "java", "js", "jsx", "ts", "tsx", "json", "xml", "html", "css", "scss", "yml", "yaml", "toml", "sh", "py", "rb", "go", "rs", "c", "cc", "cpp", "h", "hpp" -> "text/plain"
            else -> "application/octet-stream"
        }
    }

    private fun Image.buffered(): BufferedImage? {
        if (this is BufferedImage) return this
        val width = getWidth(null)
        val height = getHeight(null)
        if (width <= 0 || height <= 0) return null
        val image = BufferedImage(width, height, BufferedImage.TYPE_INT_ARGB)
        val g = image.createGraphics()
        try {
            g.drawImage(this, 0, 0, null)
        } finally {
            g.dispose()
        }
        return image
    }
}

private fun data(path: Path, mime: String) = "data:$mime;base64,${Base64.getEncoder().encodeToString(path.readBytes())}"
