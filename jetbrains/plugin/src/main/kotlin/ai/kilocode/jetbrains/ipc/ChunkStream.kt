// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.ipc

/**
 * Chunk stream, used for buffering and processing binary data chunks
 * Corresponds to ChunkStream in VSCode
 */
class ChunkStream {
    private val chunks = mutableListOf<ByteArray>()

    /**
     * Get total byte length of data in the stream
     */
    var byteLength: Int = 0
        private set

    /**
     * Accept a data chunk
     * @param buff Data chunk
     */
    fun acceptChunk(buff: ByteArray) {
        if (buff.isEmpty()) {
            return
        }
        chunks.add(buff)
        byteLength += buff.size
    }

    /**
     * Read specified number of bytes (removes data from stream)
     * @param byteCount Number of bytes to read
     * @return Data read
     */
    fun read(byteCount: Int): ByteArray {
        return _read(byteCount, true)
    }

    /**
     * Peek specified number of bytes (does not remove data from stream)
     * @param byteCount Number of bytes to peek
     * @return Data peeked
     */
    fun peek(byteCount: Int): ByteArray {
        return _read(byteCount, false)
    }

    /**
     * Internal read method
     * @param byteCount Number of bytes to read
     * @param advance Whether to remove data from stream
     * @return Data read
     */
    private fun _read(byteCount: Int, advance: Boolean): ByteArray {
        if (byteCount == 0) {
            return ByteArray(0)
        }

        if (byteCount > byteLength) {
            throw IllegalArgumentException("Cannot read so many bytes!")
        }

        if (chunks[0].size == byteCount) {
            // Fast path, first chunk is exactly the data to return
            val result = chunks[0]
            if (advance) {
                chunks.removeAt(0)
                byteLength -= byteCount
            }
            return result
        }

        if (chunks[0].size > byteCount) {
            // Fast path, data to read is completely in the first chunk
            val firstChunk = chunks[0]
            val result = ByteArray(byteCount)
            System.arraycopy(firstChunk, 0, result, 0, byteCount)

            if (advance) {
                val remaining = ByteArray(firstChunk.size - byteCount)
                System.arraycopy(firstChunk, byteCount, remaining, 0, remaining.size)
                chunks[0] = remaining
                byteLength -= byteCount
            }

            return result
        }

        // General path, need to span multiple chunks
        val result = ByteArray(byteCount)
        var resultOffset = 0
        var chunkIndex = 0
        var remainingBytes = byteCount

        while (remainingBytes > 0) {
            val chunk = chunks[chunkIndex]

            if (chunk.size > remainingBytes) {
                // Current chunk will not be fully read
                System.arraycopy(chunk, 0, result, resultOffset, remainingBytes)

                if (advance) {
                    val remaining = ByteArray(chunk.size - remainingBytes)
                    System.arraycopy(chunk, remainingBytes, remaining, 0, remaining.size)
                    chunks[chunkIndex] = remaining
                    byteLength -= remainingBytes
                }

                resultOffset += remainingBytes
                remainingBytes = 0
            } else {
                // Current chunk will be fully read
                System.arraycopy(chunk, 0, result, resultOffset, chunk.size)
                resultOffset += chunk.size
                remainingBytes -= chunk.size

                if (advance) {
                    chunks.removeAt(chunkIndex)
                    byteLength -= chunk.size
                } else {
                    chunkIndex++
                }
            }
        }

        return result
    }
}
