/**
 * Unit Tests for Diff Engine
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { DiffEngine } from '../../services/diff/diff-engine';
import { DiffResult, DiffLine } from '../../types/diff-types';

describe('DiffEngine', () => {
  beforeEach(() => {
    // Setup before each test
  });

  afterEach(() => {
    // Cleanup after each test
  });

  describe('createUnifiedDiff', () => {
    test('should create simple diff for identical content', () => {
      const original = 'line 1\nline 2';
      const modified = 'line 1\nline 2';
      
      const result = DiffEngine.createUnifiedDiff(original, modified);
      
      expect(result.additions).toHaveLength(0);
      expect(result.deletions).toHaveLength(0);
      expect(result.modifications).toHaveLength(0);
    });

    test('should create diff with additions', () => {
      const original = 'line 1\nline 2';
      const modified = 'line 1\nnew line\nline 2';
      
      const result = DiffEngine.createUnifiedDiff(original, modified);
      
      expect(result.additions).toHaveLength(1);
      expect(result.additions[0]).toEqual({
        lineNumber: 1,
        content: 'new line',
        type: 'addition'
      });
      expect(result.deletions).toHaveLength(0);
      expect(result.modifications).toHaveLength(0);
    });

    test('should create diff with deletions', () => {
      const original = 'line 1\nline 2\nline 3';
      const modified = 'line 1\nline 3';
      
      const result = DiffEngine.createUnifiedDiff(original, modified);
      
      expect(result.additions).toHaveLength(0);
      expect(result.deletions).toHaveLength(1);
      expect(result.deletions[0]).toEqual({
        lineNumber: 1,
        content: 'line 2',
        type: 'deletion'
      });
      expect(result.modifications).toHaveLength(0);
    });

    test('should handle context lines correctly', () => {
      const original = 'line 1\nline 2\nline 3\nline 4';
      const modified = 'line 1\nmodified line 2\nline 3\nline 4';
      
      const result = DiffEngine.createUnifiedDiff(original, modified, { contextLines: 1 });
      
      expect(result.additions).toHaveLength(1);
      expect(result.deletions).toHaveLength(1);
      // Should include context lines
    });
  });

  describe('createFromUnifiedDiff', () => {
    test('should parse unified diff format correctly', () => {
      const unifiedDiff = `@@ -1,2 +1,2 @@
 line 1
+new line 1
 line 2
-new line 2
+new line 2`;
      
      const result = DiffEngine.createFromUnifiedDiff(unifiedDiff);
      
      expect(result.additions).toHaveLength(2);
      expect(result.deletions).toHaveLength(2);
      expect(result.additions[0]).toEqual({
        lineNumber: 0,
        content: 'new line 1',
        type: 'addition'
      });
      expect(result.additions[1]).toEqual({
        lineNumber: 3,
        content: 'new line 2',
        type: 'addition'
      });
    });

    test('should handle empty unified diff', () => {
      const unifiedDiff = '';
      
      const result = DiffEngine.createFromUnifiedDiff(unifiedDiff);
      
      expect(result.additions).toHaveLength(0);
      expect(result.deletions).toHaveLength(0);
      expect(result.modifications).toHaveLength(0);
    });
  });

  describe('createStreamingDiff', () => {
    test('should process small files normally', async () => {
      const original = 'small content';
      const modified = 'small content modified';
      
      const result = await DiffEngine.createStreamingDiff(original, modified);
      
      expect(result.additions).toBeDefined();
      expect(result.deletions).toBeDefined();
    });

    test('should process large files in chunks', async () => {
      const largeContent = 'line '.repeat(10000);
      const modifiedContent = 'modified line '.repeat(10000);
      
      let progressCalls = 0;
      const result = await DiffEngine.createStreamingDiff(
        largeContent,
        modifiedContent,
        {
          chunkSize: 1000,
          onProgress: () => progressCalls++
        }
      );
      
      expect(result.additions).toBeDefined();
      expect(progressCalls).toBeGreaterThan(1); // Should call progress multiple times
    });
  });
});
