/**
 * Integration Tests for Diff Visualization
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import * as vscode from 'vscode';
import { VSCodeIntegration } from '../../services/integration/editor-hooks';
import { DiffEngine } from '../../services/diff/diff-engine';

// Mock VSCode API for testing
const mockVSCode = {
  window: {
    showTextDocument: vi.fn(),
    activeTextEditor: undefined,
    showInformationMessage: vi.fn(),
    showErrorMessage: vi.fn(),
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
  }
} as any;

describe('Diff Visualization Integration', () => {
  beforeEach(() => {
    // Mock VSCode API
    global.vscode = mockVSCode;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Diff Overlay Creation', () => {
    test('should create diff overlay for simple changes', async () => {
      const originalContent = 'line 1\nline 2';
      const modifiedContent = 'line 1\nmodified line\nline 2';
      
      // Create diff
      const diffResult = DiffEngine.createUnifiedDiff(originalContent, modifiedContent);
      
      // Mock document
      const mockDocument = {
        uri: { fsPath: '/test/file.js' },
        getText: vi.fn().mockReturnValue(originalContent)
      };
      
      mockVSCode.workspace.textDocuments.push(mockDocument);
      mockVSCode.window.activeTextEditor = {
        document: mockDocument,
        edit: vi.fn()
      };
      
      // Test diff overlay creation
      expect(diffResult.additions).toHaveLength(1);
      expect(diffResult.deletions).toHaveLength(1);
    });

    test('should handle multiple changes in single file', async () => {
      const originalContent = 'line 1\nline 2\nline 3';
      const modifiedContent = 'modified line 1\nline 2\nline 3\nnew line 4';
      
      const diffResult = DiffEngine.createUnifiedDiff(originalContent, modifiedContent);
      
      expect(diffResult.additions).toHaveLength(2);
      expect(diffResult.deletions).toHaveLength(1);
    });
  });

  describe('Editor Integration', () => {
    test('should apply text changes correctly', async () => {
      const mockDocument = {
        uri: { fsPath: '/test/file.js' },
        getText: vi.fn().mockReturnValue('original content')
      };
      
      const changes = [
        {
          range: new vscode.Range(0, 0, 0, 5),
          text: 'modified'
        }
      ];
      
      mockVSCode.workspace.textDocuments.push(mockDocument);
      
      const result = await VSCodeIntegration.applyTextChanges(mockDocument as any, changes);
      
      expect(result).toBe(true);
      expect(mockVSCode.workspace.applyEdit).toHaveBeenCalledWith(
        expect.objectContaining({
          edits: [expect.objectContaining({
            range: changes[0].range,
            text: changes[0].text
          })]
        })
      );
    });

    test('should handle file opening correctly', async () => {
      const filePath = '/test/new-file.js';
      
      const result = await VSCodeIntegration.openFile(filePath);
      
      expect(result.success).toBe(true);
      expect(result.isNewTab).toBe(true);
      expect(mockVSCode.workspace.openTextDocument).toHaveBeenCalledWith(
        expect.objectContaining({ fsPath: filePath })
      );
    });

    test('should handle existing file correctly', async () => {
      const filePath = '/test/existing-file.js';
      
      // Mock existing tab
      const existingTab = {
        input: { uri: { fsPath: filePath } }
      };
      mockVSCode.window.tabGroups = {
        all: [ [{ tabs: [existingTab] }]
      };
      
      const result = await VSCodeIntegration.openFile(filePath);
      
      expect(result.success).toBe(true);
      expect(result.isNewTab).toBe(false);
    });
  });

  describe('Error Handling', () => {
    test('should handle file not found gracefully', async () => {
      const filePath = '/test/nonexistent.js';
      
      const result = await VSCodeIntegration.openFile(filePath);
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('File does not exist');
    });

    test('should handle permission errors gracefully', async () => {
      // Mock permission error
      mockVSCode.workspace.fs.stat = vi.fn().mockRejectedValue(new Error('Permission denied'));
      
      const result = await VSCodeIntegration.openFile('/test/file.js');
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to open file');
    });
  });

  describe('Performance', () => {
    test('should handle large diffs efficiently', async () => {
      const largeContent = 'line '.repeat(1000);
      const modifiedContent = 'modified line '.repeat(1000);
      
      const startTime = Date.now();
      const result = await DiffEngine.createStreamingDiff(largeContent, modifiedContent);
      const endTime = Date.now();
      
      expect(result.additions).toBeDefined();
      expect(endTime - startTime).toBeLessThan(1000); // Should complete within 1 second
    });
  });
});
