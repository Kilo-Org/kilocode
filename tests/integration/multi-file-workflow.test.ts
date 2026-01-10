/**
 * Integration Test for Multi-File Workflow
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import * as vscode from 'vscode';
import { FileOpenerService } from '../../services/file-management/file-opener';
import { SessionStateManager } from '../../services/session/session-state';
import { DiffEngine } from '../../services/diff/diff-engine';

// Mock VSCode API for testing
const mockVSCode = {
  window: {
    showTextDocument: vi.fn(),
    activeTextEditor: undefined,
    showInformationMessage: vi.fn(),
    showErrorMessage: vi.fn(),
    showWarningMessage: vi.fn(),
    createOutputChannel: vi.fn(() => ({
      appendLine: vi.fn(),
      show: vi.fn(),
      clear: vi.fn()
    }))
  },
  workspace: {
    openTextDocument: vi.fn(),
    textDocuments: [],
    applyEdit: vi.fn().mockResolvedValue(true)
  },
  commands: {
    registerCommand: vi.fn(),
    executeCommand: vi.fn()
  }
} as any;

describe('Multi-File Workflow Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.vscode = mockVSCode;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('File Opener Service', () => {
    test('should open multiple files sequentially', async () => {
      const filePaths = [
        '/test/file1.js',
        '/test/file2.js',
        '/test/file3.js'
      ];

      const fileOpener = new FileOpenerService();
      const results = await fileOpener.openMultipleFiles(filePaths);

      expect(results.success).toBe(true);
      expect(results.results).toHaveLength(3);
      expect(mockVSCode.workspace.openTextDocument).toHaveBeenCalledTimes(3);
      expect(mockVSCode.window.showTextDocument).toHaveBeenCalledTimes(3);
    });

    test('should handle file opening errors gracefully', async () => {
      const fileOpener = new FileOpenerService();
      mockVSCode.workspace.openTextDocument.mockRejectedValueOnce(new Error('Permission denied'));

      const results = await fileOpener.openMultipleFiles(['/test/file1.js']);

      expect(results.success).toBe(false);
      expect(results.results[0].success).toBe(false);
      expect(results.results[0].error).toContain('Permission denied');
    });

    test('should detect existing files and avoid reopening', async () => {
      // Mock existing tabs
      mockVSCode.window.tabGroups = {
        all: [{
          tabs: [
            { input: { uri: { fsPath: '/test/file1.js' } } },
            { input: { uri: { fsPath: '/test/file2.js' } } }
          ]
        }]
      };

      const fileOpener = new FileOpenerService();
      const results = await fileOpener.openMultipleFiles(['/test/file1.js', '/test/file2.js']);

      expect(results.success).toBe(true);
      expect(results.results[0].isNewTab).toBe(false);
      expect(results.results[1].isNewTab).toBe(false);
    });
  });

  describe('Session State Management', () => {
    test('should track multiple file states', async () => {
      const mockContext = {
        globalState: {
          get: vi.fn(),
          update: vi.fn().mockResolvedValue(undefined)
        }
      } as any;

      const sessionManager = SessionStateManager.getInstance(mockContext);
      await sessionManager.initialize();

      // Simulate adding multiple files
      await sessionManager.addFileState('/test/file1.js', {
        hasUnsavedChanges: false,
        activeDiffCount: 2,
        lastSyncVersion: 1
      });

      await sessionManager.addFileState('/test/file2.js', {
        hasUnsavedChanges: true,
        activeDiffCount: 1,
        lastSyncVersion: 2
      });

      await sessionManager.addFileState('/test/file3.js', {
        hasUnsavedChanges: false,
        activeDiffCount: 0,
        lastSyncVersion: 1
      });

      const stats = sessionManager.getSessionStats();
      expect(stats.totalFiles).toBe(3);
      expect(stats.activeDiffs).toBe(3);
    });

    test('should persist session state across restarts', async () => {
      const mockContext = {
        globalState: {
          get: vi.fn().mockReturnValue({
            id: 'test-session',
            activeShadowBuffers: ['buffer1', 'buffer2'],
            fileStates: {
              '/test/file1.js': {
                hasUnsavedChanges: false,
                activeDiffCount: 1,
                lastSyncVersion: 1
              }
            },
            globalSettings: {
              autoSave: false,
              diffColorScheme: 'vscode',
              maxFileSize: 10485760
            },
            createdAt: new Date('2023-01-01T00:00:00.000Z'),
            lastActivity: new Date('2023-01-01T12:00:00.000Z')
          }),
          update: vi.fn().mockResolvedValue(undefined)
        }
      } as any;

      const sessionManager = SessionStateManager.getInstance(mockContext);
      await sessionManager.initialize();

      const fileState = sessionManager.getFileState('/test/file1.js');
      expect(fileState).toEqual({
        hasUnsavedChanges: false,
        activeDiffCount: 1,
        lastSyncVersion: 1
      });

      expect(mockContext.globalState.update).toHaveBeenCalledWith(
        'diffSystem.session',
        expect.objectContaining({
          activeShadowBuffers: ['buffer1', 'buffer2']
        })
      );
    });
  });

  describe('Multi-File Diff Coordination', () => {
    test('should coordinate diffs across multiple files', async () => {
      const fileOpener = new FileOpenerService();
      const mockContext = {
        globalState: {
          get: vi.fn(),
          update: vi.fn().mockResolvedValue(undefined)
        }
      } as any;

      const sessionManager = SessionStateManager.getInstance(mockContext);
      await sessionManager.initialize();

      // Simulate opening files and creating diffs
      await fileOpener.openMultipleFiles(['/test/file1.js', '/test/file2.js']);
      
      const diff1 = DiffEngine.createUnifiedDiff(
        'original content 1',
        'modified content 1\nnew line 1'
      );

      const diff2 = DiffEngine.createUnifiedDiff(
        'original content 2',
        'modified content 2\nnew line 2'
      );

      // Add shadow buffers to session
      await sessionManager.addShadowBuffer('buffer1');
      await sessionManager.addShadowBuffer('buffer2');

      const stats = sessionManager.getSessionStats();
      expect(stats.activeDiffs).toBe(2);
    });

    test('should handle file-specific diff operations', async () => {
      const fileOpener = new FileOpenerService();
      const sessionManager = SessionStateManager.getInstance({} as any);
      await sessionManager.initialize();

      // Open file and create diff
      await fileOpener.openFile('/test/file1.js');
      
      const diff = DiffEngine.createUnifiedDiff(
        'original line 1\noriginal line 2',
        'modified line 1\nmodified line 2\nnew line 3'
      );

      // Verify file state is tracked
      const fileState = sessionManager.getFileState('/test/file1.js');
      expect(fileState).toBeDefined();
      expect(fileState?.activeDiffCount).toBeGreaterThan(0);
    });
  });

  describe('Performance and Scalability', () => {
    test('should handle multiple simultaneous operations', async () => {
      const startTime = Date.now();
      
      const fileOpener = new FileOpenerService();
      const sessionManager = SessionStateManager.getInstance({} as any);
      await sessionManager.initialize();

      // Simulate multiple concurrent operations
      const operations = [
        fileOpener.openFile('/test/file1.js'),
        fileOpener.openFile('/test/file2.js'),
        fileOpener.openFile('/test/file3.js'),
        sessionManager.addFileState('/test/file1.js', { hasUnsavedChanges: false, activeDiffCount: 1, lastSyncVersion: 1 }),
        sessionManager.addFileState('/test/file2.js', { hasUnsavedChanges: false, activeDiffCount: 1, lastSyncVersion: 1 }),
        sessionManager.addFileState('/test/file3.js', { hasUnsavedChanges: false, activeDiffCount: 1, lastSyncVersion: 1 })
      ];

      await Promise.all(operations);

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Should complete within reasonable time (less than 1 second for simple operations)
      expect(duration).toBeLessThan(1000);
    });

    test('should maintain UI responsiveness during large operations', async () => {
      const fileOpener = new FileOpenerService();
      await fileOpener.initialize();

      // Create large diff (simulate 1000+ lines)
      const largeContent = 'line '.repeat(1000);
      const modifiedContent = 'modified line '.repeat(1000);
      
      const startTime = Date.now();
      const diff = await DiffEngine.createStreamingDiff(
        largeContent,
        modifiedContent,
        {
          chunkSize: 1000,
          onProgress: vi.fn()
        }
      );
      const endTime = Date.now();

      // Progress should be called multiple times
      expect(diff.additions).toBeDefined();
      expect(vi.mocked(diff.createStreamingDiff).onProgress).toHaveBeenCalledTimes(expect.anything());
      
      // Should complete in reasonable time with streaming
      expect(endTime - startTime).toBeLessThan(5000);
    });
  });

  describe('Error Handling and Recovery', () => {
    test('should handle file not found errors', async () => {
      const fileOpener = new FileOpenerService();
      mockVSCode.workspace.openTextDocument.mockRejectedValueOnce(new Error('File not found'));

      const result = await fileOpener.openFile('/nonexistent/file.js');
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('File does not exist');
    });

    test('should handle permission errors gracefully', async () => {
      const fileOpener = new FileOpenerService();
      mockVSCode.workspace.openTextDocument.mockRejectedValueOnce(new Error('Permission denied'));

      const result = await fileOpener.openFile('/test/file.js');
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('Permission denied');
    });

    test('should validate inputs before operations', async () => {
      const fileOpener = new FileOpenerService();
      
      // Test with invalid file path
      const result1 = await fileOpener.openFile('');
      
      expect(result1.success).toBe(false);
      expect(result1.error).toContain('required');

      // Test with null file path
      const result2 = await fileOpener.openFile(null as any);
      
      expect(result2.success).toBe(false);
      expect(result2.error).toContain('required');
    });
  });
});
