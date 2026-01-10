/**
 * Diff Library Integration
 * 
 * Provides core diff functionality using the 'diff' library
 * with custom optimizations for streaming and large file handling
 */

import * as diff from 'diff';
import { DiffResult, DiffLine, StreamingDiffOptions } from '../../types/diff-types';
import { FileBufferEntity } from '../../entities/file-buffer';
import { ShadowBufferEntity } from '../../entities/shadow-buffer';
import { DiffOverlayEntity } from '../../entities/diff-overlay';
import { Logger } from '../error-handler';

/**
 * Core diff engine with support for various diff formats
 */
export class DiffEngine {
  private static readonly DEFAULT_CHUNK_SIZE = 65536; // 64KB

  /**
   * Create unified diff between two text contents
   */
  static createUnifiedDiff(
    original: string,
    modified: string,
    options: { contextLines?: number } = {}
  ): DiffResult {
    try {
      const contextLines = options.contextLines || 3;
      const patches = diff.createPatch(
        'file',
        original,
        modified,
        undefined,
        undefined,
        { context: contextLines }
      );

      return this.parsePatchToResult(patches);
    } catch (error) {
      Logger.error('DiffEngine.createUnifiedDiff', 'Failed to create unified diff', error);
      return {
        additions: [],
        deletions: [],
        modifications: []
      };
    }
  }

  /**
   * Create diff from unified diff format string
   */
  static createFromUnifiedDiff(
    unifiedDiff: string
  ): DiffResult {
    try {
      const lines = unifiedDiff.split('\n');
      const result: DiffResult = {
        additions: [],
        deletions: [],
        modifications: []
      };

      let currentLine = 0;
      for (const line of lines) {
        if (line.startsWith('@@')) {
          // Parse line numbers from @@ -start,count +start,count @@
          const match = line.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
          if (match) {
            currentLine = parseInt(match[3]) - 1;
          }
          continue;
        }

        if (line.startsWith('+')) {
          result.additions.push({
            lineNumber: currentLine++,
            content: line.substring(1),
            type: 'addition'
          });
        } else if (line.startsWith('-')) {
          result.deletions.push({
            lineNumber: currentLine,
            content: line.substring(1),
            type: 'deletion'
          });
        } else if (line.startsWith(' ')) {
          currentLine++;
          // Context line - not added to result
        }
      }

      return result;
    } catch (error) {
      Logger.error('DiffEngine.createFromUnifiedDiff', 'Failed to parse unified diff', error);
      return {
        additions: [],
        deletions: [],
        modifications: []
      };
    }
  }

  /**
   * Create diff with streaming support for large files
   */
  static async createStreamingDiff(
    original: string,
    modified: string,
    options: StreamingDiffOptions = {}
  ): Promise<DiffResult> {
    try {
      const chunkSize = options.chunkSize || this.DEFAULT_CHUNK_SIZE;
      const onProgress = options.onProgress || (() => {});

      // For large files, process in chunks to avoid blocking
      if (original.length > chunkSize || modified.length > chunkSize) {
        Logger.debug('DiffEngine.createStreamingDiff', `Processing large diff in chunks of ${chunkSize} bytes`);
        return this.processLargeFileInChunks(original, modified, chunkSize, onProgress);
      }

      // For smaller files, process normally
      onProgress(100);
      return this.createUnifiedDiff(original, modified);
    } catch (error) {
      Logger.error('DiffEngine.createStreamingDiff', 'Failed to create streaming diff', error);
      return {
        additions: [],
        deletions: [],
        modifications: []
      };
    }
  }

  /**
   * Process large files in chunks to maintain UI responsiveness
   */
  private static async processLargeFileInChunks(
    original: string,
    modified: string,
    chunkSize: number,
    onProgress: (progress: number) => void
  ): Promise<DiffResult> {
    return new Promise((resolve) => {
      setTimeout(() => {
        try {
          // Simple chunked processing - in real implementation,
          // this would use more sophisticated chunking
          const originalChunks = this.chunkString(original, chunkSize);
          const modifiedChunks = this.chunkString(modified, chunkSize);
          
          let result: DiffResult = {
            additions: [],
            deletions: [],
            modifications: []
          };

          const totalChunks = Math.max(originalChunks.length, modifiedChunks.length);
          
          for (let i = 0; i < totalChunks; i++) {
            const chunkResult = this.createUnifiedDiff(
              originalChunks[i] || '',
              modifiedChunks[i] || ''
            );
            
            // Merge chunk results
            result.additions.push(...chunkResult.additions);
            result.deletions.push(...chunkResult.deletions);
            result.modifications.push(...chunkResult.modifications);
            
            // Report progress
            const progress = Math.round(((i + 1) / totalChunks) * 100);
            onProgress(progress);
            
            // Yield control to maintain UI responsiveness
            if (i % 5 === 0) {
              await new Promise(resolve => setTimeout(resolve, 0));
            }
          }

          resolve(result);
        } catch (error) {
          Logger.error('DiffEngine.processLargeFileInChunks', 'Failed to process chunk', error);
          resolve({
            additions: [],
            deletions: [],
            modifications: []
          });
        }
      }, 0);
    });
  }

  /**
   * Split string into chunks of specified size
   */
  private static chunkString(str: string, chunkSize: number): string[] {
    const chunks: string[] = [];
    for (let i = 0; i < str.length; i += chunkSize) {
      chunks.push(str.slice(i, i + chunkSize));
    }
    return chunks;
  }

  /**
   * Parse diff patch string to structured result
   */
  private static parsePatchToResult(patch: string): DiffResult {
    const result: DiffResult = {
      additions: [],
      deletions: [],
      modifications: []
    };

    const lines = patch.split('\n');
    let currentLine = 0;

    for (const line of lines) {
      if (line.startsWith('@@')) {
        const match = line.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
        if (match) {
          currentLine = parseInt(match[3]) - 1;
        }
        continue;
      }

      if (line.startsWith('+')) {
        result.additions.push({
          lineNumber: currentLine++,
          content: line.substring(1),
          type: 'addition'
        });
      } else if (line.startsWith('-')) {
        result.deletions.push({
          lineNumber: currentLine,
          content: line.substring(1),
          type: 'deletion'
        });
      } else if (line.startsWith(' ')) {
        currentLine++;
      }
    }

    return result;
  }

  /**
   * Create diff overlay entities from diff result
   */
  static createOverlaysFromResult(
    diffResult: DiffResult,
    shadowBufferId: string
  ): DiffOverlay[] {
    const overlays: DiffOverlay[] = [];
    let overlayId = 0;

    // Process additions
    for (const addition of diffResult.additions) {
      overlays.push(DiffOverlayEntity.create(
        `overlay_${++overlayId}`,
        shadowBufferId,
        addition.lineNumber,
        addition.lineNumber,
        'addition',
        addition.content
      ));
    }

    // Process deletions
    for (const deletion of diffResult.deletions) {
      overlays.push(DiffOverlayEntity.create(
        `overlay_${++overlayId}`,
        shadowBufferId,
        deletion.lineNumber,
        deletion.lineNumber,
        'deletion',
        deletion.content
      ));
    }

    return overlays;
  }

  /**
   * Apply diff overlay to file buffer
   */
  static applyOverlaysToBuffer(
    fileBuffer: FileBufferEntity,
    overlays: DiffOverlay[]
  ): { success: boolean; updatedContent: string; appliedOverlays: DiffOverlay[] } {
    try {
      let updatedContent = fileBuffer.content;
      const appliedOverlays: DiffOverlay[] = [];

      // Sort overlays by line number (descending to apply from bottom to top)
      const sortedOverlays = [...overlays].sort((a, b) => b.startLine - a.startLine);

      for (const overlay of sortedOverlays) {
        if (overlay.isAccepted && !overlay.isRejected) {
          // Apply accepted changes
          const lines = updatedContent.split('\n');
          
          if (overlay.type === 'addition') {
            // Insert addition at specified line
            lines.splice(overlay.startLine, 0, overlay.content);
          } else if (overlay.type === 'deletion') {
            // Remove deletion line
            lines.splice(overlay.startLine, 1);
          }

          updatedContent = lines.join('\n');
          appliedOverlays.push(overlay);
        }
      }

      return {
        success: true,
        updatedContent,
        appliedOverlays
      };
    } catch (error) {
      Logger.error('DiffEngine.applyOverlaysToBuffer', 'Failed to apply overlays', error);
      return {
        success: false,
        updatedContent: fileBuffer.content,
        appliedOverlays: []
      };
    }
  }
}
