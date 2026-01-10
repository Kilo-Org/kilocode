/**
 * Streaming Diff Processor
 * 
 * Handles non-blocking diff processing for large files with chunked processing
 */

import * as vscode from 'vscode';
import { Logger } from '../error-handler';
import { FileBuffer, ShadowBuffer, DiffOverlay, DiffLine } from '../../types/diff-types';

export interface StreamingDiffOptions {
  chunkSize: number;
  maxConcurrency: number;
  enableProgress: boolean;
  progressCallback?: (progress: StreamingDiffProgress) => void;
}

export interface StreamingDiffProgress {
  totalChunks: number;
  processedChunks: number;
  currentChunk: number;
  bytesProcessed: number;
  totalBytes: number;
  percentage: number;
  isComplete: boolean;
  error?: string;
}

export interface DiffChunk {
  id: string;
  type: 'addition' | 'deletion' | 'modification' | 'unchanged';
  originalStart: number;
  originalEnd: number;
  modifiedStart: number;
  modifiedEnd: number;
  originalContent: string;
  modifiedContent: string;
  changes: Array<{
    type: 'insert' | 'delete' | 'replace';
    position: number;
    content?: string;
    oldContent?: string;
    newContent?: string;
  }>;
}

export interface StreamingDiffResult {
  success: boolean;
  shadowBuffer: ShadowBuffer | null;
  diffOverlay: DiffOverlay | null;
  processingTime: number;
  chunksProcessed: number;
  error?: string;
}

/**
 * Streaming diff processor for large files
 */
export class StreamingDiffProcessor {
  private static readonly DEFAULT_CHUNK_SIZE = 65536; // 64KB
  private static readonly DEFAULT_MAX_CONCURRENCY = 4;
  private static readonly PROGRESS_UPDATE_INTERVAL = 100; // ms

  private isProcessing: boolean = false;
  private currentProgress: StreamingDiffProgress | null = null;
  private progressTimer: NodeJS.Timeout | null = null;

  /**
   * Process diff with streaming for large files
   */
  async processStreamingDiff(
    originalBuffer: FileBuffer,
    modifiedContent: string,
    options: Partial<StreamingDiffOptions> = {}
  ): Promise<StreamingDiffResult> {
    const startTime = Date.now();
    
    try {
      const mergedOptions: StreamingDiffOptions = {
        chunkSize: options.chunkSize || StreamingDiffProcessor.DEFAULT_CHUNK_SIZE,
        maxConcurrency: options.maxConcurrency || StreamingDiffProcessor.DEFAULT_MAX_CONCURRENCY,
        enableProgress: options.enableProgress || false,
        progressCallback: options.progressCallback
      };

      Logger.debug('StreamingDiffProcessor.processStreamingDiff', 
        `Starting streaming diff for file: ${originalBuffer.filePath}`);

      this.isProcessing = true;

      // Initialize progress tracking
      this.initializeProgress(modifiedContent.length, mergedOptions);

      // Create shadow buffer with streaming
      const shadowBuffer = await this.createShadowBufferStreaming(originalBuffer, modifiedContent, mergedOptions);

      // Create diff overlay with streaming
      const diffOverlay = await this.createDiffOverlayStreaming(originalBuffer, shadowBuffer, mergedOptions);

      // Finalize progress
      this.finalizeProgress();

      const processingTime = Date.now() - startTime;

      Logger.info('StreamingDiffProcessor.processStreamingDiff', 
        `Completed streaming diff in ${processingTime}ms for ${this.currentProgress?.totalChunks || 0} chunks`);

      return {
        success: true,
        shadowBuffer,
        diffOverlay,
        processingTime,
        chunksProcessed: this.currentProgress?.processedChunks || 0
      };

    } catch (error) {
      const errorMessage = `Failed to process streaming diff: ${error instanceof Error ? error.message : String(error)}`;
      Logger.error('StreamingDiffProcessor.processStreamingDiff', errorMessage, error);

      this.updateProgress({ error: errorMessage, isComplete: true });

      return {
        success: false,
        shadowBuffer: null,
        diffOverlay: null,
        processingTime: Date.now() - startTime,
        chunksProcessed: this.currentProgress?.processedChunks || 0,
        error: errorMessage
      };
    } finally {
      this.isProcessing = false;
      this.cleanupProgress();
    }
  }

  /**
   * Create shadow buffer with streaming
   */
  private async createShadowBufferStreaming(
    originalBuffer: FileBuffer,
    modifiedContent: string,
    options: StreamingDiffOptions
  ): Promise<ShadowBuffer> {
    try {
      const shadowBufferId = this.generateShadowBufferId(originalBuffer.filePath);
      const chunks: string[] = [];

      // Process content in chunks
      for (let i = 0; i < modifiedContent.length; i += options.chunkSize) {
        const chunk = modifiedContent.substring(i, i + options.chunkSize);
        chunks.push(chunk);

        // Update progress
        this.updateProgress({
          processedChunks: chunks.length,
          bytesProcessed: Math.min(i + options.chunkSize, modifiedContent.length)
        });

        // Yield control to prevent blocking
        if (chunks.length % 10 === 0) {
          await this.yieldControl();
        }
      }

      const shadowBuffer: ShadowBuffer = {
        id: shadowBufferId,
        fileBufferId: originalBuffer.id,
        originalContent: originalBuffer.content,
        modifiedContent: modifiedContent,
        diffFormat: 'unified',
        createdAt: new Date(),
        status: 'pending'
      };

      Logger.debug('StreamingDiffProcessor.createShadowBufferStreaming', 
        `Created shadow buffer with ${chunks.length} chunks`);

      return shadowBuffer;
    } catch (error) {
      Logger.error('StreamingDiffProcessor.createShadowBufferStreaming', 'Failed to create shadow buffer', error);
      throw error;
    }
  }

  /**
   * Create diff overlay with streaming
   */
  private async createDiffOverlayStreaming(
    originalBuffer: FileBuffer,
    shadowBuffer: ShadowBuffer,
    options: StreamingDiffOptions
  ): Promise<DiffOverlay> {
    try {
      const diffOverlayId = this.generateDiffOverlayId(originalBuffer.filePath);
      const diffChunks: DiffChunk[] = [];

      // Process diff generation in chunks
      const originalLines = originalBuffer.content.split('\n');
      const modifiedLines = shadowBuffer.modifiedContent.split('\n');

      // Process lines in batches to avoid blocking
      const batchSize = Math.ceil(originalLines.length / options.maxConcurrency);
      
      for (let batchStart = 0; batchStart < originalLines.length; batchStart += batchSize) {
        const batchEnd = Math.min(batchStart + batchSize, originalLines.length);
        const batchDiffChunks = await this.processBatchDiff(
          originalLines.slice(batchStart, batchEnd),
          modifiedLines.slice(batchStart, batchEnd),
          batchStart
        );

        diffChunks.push(...batchDiffChunks);

        // Update progress
        this.updateProgress({
          processedChunks: Math.ceil(batchEnd / batchSize)
        });

        // Yield control
        await this.yieldControl();
      }

      const diffOverlay: DiffOverlay = {
        id: diffOverlayId,
        shadowBufferId: shadowBuffer.id,
        startLine: 0,
        endLine: Math.max(originalLines.length, modifiedLines.length),
        type: 'modification',
        content: shadowBuffer.modifiedContent,
        isAccepted: false,
        isRejected: false
      };

      Logger.debug('StreamingDiffProcessor.createDiffOverlayStreaming', 
        `Created diff overlay with ${diffChunks.length} chunks`);

      return diffOverlay;
    } catch (error) {
      Logger.error('StreamingDiffProcessor.createDiffOverlayStreaming', 'Failed to create diff overlay', error);
      throw error;
    }
  }

  /**
   * Process batch of lines for diff generation
   */
  private async processBatchDiff(
    originalLines: string[],
    modifiedLines: string[],
    offset: number
  ): Promise<DiffChunk[]> {
    try {
      const chunks: DiffChunk[] = [];

      // Simple diff algorithm for batch processing
      for (let i = 0; i < Math.max(originalLines.length, modifiedLines.length); i++) {
        const originalLine = originalLines[i];
        const modifiedLine = modifiedLines[i];

        if (originalLine === modifiedLine) {
          // Unchanged line
          if (originalLine !== undefined) {
            chunks.push({
              id: `chunk_${offset + i}`,
              type: 'unchanged',
              originalStart: offset + i,
              originalEnd: offset + i + 1,
              modifiedStart: offset + i,
              modifiedEnd: offset + i + 1,
              originalContent: originalLine,
              modifiedContent: modifiedLine,
              changes: []
            });
          }
        } else if (!originalLine && modifiedLine) {
          // Added line
          chunks.push({
            id: `chunk_${offset + i}`,
            type: 'addition',
            originalStart: offset + i,
            originalEnd: offset + i,
            modifiedStart: offset + i,
            modifiedEnd: offset + i + 1,
            originalContent: '',
            modifiedContent: modifiedLine,
            changes: [{
              type: 'insert',
              position: offset + i,
              content: modifiedLine
            }]
          });
        } else if (originalLine && !modifiedLine) {
          // Deleted line
          chunks.push({
            id: `chunk_${offset + i}`,
            type: 'deletion',
            originalStart: offset + i,
            originalEnd: offset + i + 1,
            modifiedStart: offset + i,
            modifiedEnd: offset + i,
            originalContent: originalLine,
            modifiedContent: '',
            changes: [{
              type: 'delete',
              position: offset + i,
              content: originalLine
            }]
          });
        } else {
          // Modified line
          chunks.push({
            id: `chunk_${offset + i}`,
            type: 'modification',
            originalStart: offset + i,
            originalEnd: offset + i + 1,
            modifiedStart: offset + i,
            modifiedEnd: offset + i + 1,
            originalContent: originalLine || '',
            modifiedContent: modifiedLine || '',
            changes: [{
              type: 'replace',
              position: offset + i,
              oldContent: originalLine || '',
              newContent: modifiedLine || ''
            }]
          });
        }
      }

      return chunks;
    } catch (error) {
      Logger.error('StreamingDiffProcessor.processBatchDiff', 'Failed to process batch diff', error);
      throw error;
    }
  }

  /**
   * Check if streaming is needed for file size
   */
  static needsStreaming(content: string, threshold: number = 1024 * 1024): boolean {
    return content.length > threshold; // Default 1MB threshold
  }

  /**
   * Get optimal chunk size based on content and system resources
   */
  static getOptimalChunkSize(contentSize: number): number {
    // Base chunk sizes for different content sizes
    if (contentSize < 1024 * 1024) {
      return 32768; // 32KB for small files
    } else if (contentSize < 10 * 1024 * 1024) {
      return 65536; // 64KB for medium files
    } else {
      return 131072; // 128KB for large files
    }
  }

  /**
   * Cancel current processing
   */
  cancelProcessing(): void {
    if (this.isProcessing) {
      this.isProcessing = false;
      this.updateProgress({ error: 'Processing cancelled', isComplete: true });
      Logger.info('StreamingDiffProcessor.cancelProcessing', 'Streaming diff processing cancelled');
    }
  }

  /**
   * Get current processing progress
   */
  getCurrentProgress(): StreamingDiffProgress | null {
    return this.currentProgress;
  }

  /**
   * Check if currently processing
   */
  isCurrentlyProcessing(): boolean {
    return this.isProcessing;
  }

  /**
   * Initialize progress tracking
   */
  private initializeProgress(totalBytes: number, options: StreamingDiffOptions): void {
    const totalChunks = Math.ceil(totalBytes / options.chunkSize);
    
    this.currentProgress = {
      totalChunks,
      processedChunks: 0,
      currentChunk: 0,
      bytesProcessed: 0,
      totalBytes,
      percentage: 0,
      isComplete: false
    };

    if (options.enableProgress && options.progressCallback) {
      this.progressTimer = setInterval(() => {
        if (this.currentProgress) {
          options.progressCallback!(this.currentProgress);
        }
      }, StreamingDiffProcessor.PROGRESS_UPDATE_INTERVAL);
    }
  }

  /**
   * Update progress
   */
  private updateProgress(updates: Partial<StreamingDiffProgress>): void {
    if (!this.currentProgress) return;

    this.currentProgress = {
      ...this.currentProgress,
      ...updates,
      percentage: this.currentProgress.totalBytes > 0 
        ? (this.currentProgress.bytesProcessed / this.currentProgress.totalBytes) * 100 
        : 0
    };
  }

  /**
   * Finalize progress
   */
  private finalizeProgress(): void {
    if (this.currentProgress) {
      this.currentProgress.isComplete = true;
      this.currentProgress.percentage = 100;
    }
  }

  /**
   * Cleanup progress tracking
   */
  private cleanupProgress(): void {
    if (this.progressTimer) {
      clearInterval(this.progressTimer);
      this.progressTimer = null;
    }
  }

  /**
   * Yield control to prevent blocking
   */
  private async yieldControl(): Promise<void> {
    return new Promise(resolve => {
      setTimeout(resolve, 0);
    });
  }

  /**
   * Generate shadow buffer ID
   */
  private generateShadowBufferId(filePath: string): string {
    return `shadow_${filePath.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}`;
  }

  /**
   * Generate diff overlay ID
   */
  private generateDiffOverlayId(filePath: string): string {
    return `overlay_${filePath.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}`;
  }

  /**
   * Generate chunk hash for integrity checking
   */
  private generateChunkHash(content: string): string {
    // Simple hash function - in production, use crypto
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString(16);
  }
}
