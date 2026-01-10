/**
 * VSCode Extension API Integration Layer
 * 
 * Provides integration points with VSCode extension APIs
 * for file operations, tab management, and editor interactions
 */

import * as vscode from 'vscode';
import { FileBuffer } from '../../types/diff-types';

/**
 * VSCode API integration service
 */
export class VSCodeIntegration {
  private static readonly DIFF_SCHEME = 'diff-preview';
  
  /**
   * Open file programmatically in VSCode
   */
  static async openFile(
    filePath: string,
    options: {
      action?: 'open' | 'focus' | 'background';
      createIfNotExists?: boolean;
    } = {}
  ): Promise<{ success: boolean; fileBufferId?: string; isNewTab?: boolean; error?: string }> {
    try {
      const uri = vscode.Uri.file(filePath);
      
      // Check if file exists
      try {
        await vscode.workspace.fs.stat(uri);
      } catch (error) {
        if (options.createIfNotExists) {
          await vscode.workspace.fs.writeFile(uri, new Uint8Array());
        } else {
          return {
            success: false,
            error: `File does not exist: ${filePath}`
          };
        }
      }

      // Check if file is already open
      const existingTab = vscode.window.tabGroups.all
        .flatMap(group => group.tabs)
        .find(tab => tab.input instanceof vscode.TabInputText && 
                    tab.input.uri.fsPath === filePath);

      let document: vscode.TextDocument;
      
      if (existingTab && existingTab.input instanceof vscode.TabInputText && options.action !== 'open') {
        // File is already open, just focus it
        await vscode.window.showTextDocument(existingTab.input.uri);
        return {
          success: true,
          fileBufferId: this.generateBufferId(existingTab.input.uri),
          isNewTab: false
        };
      }

      // Open the document
      document = await vscode.workspace.openTextDocument(uri);
      
      // Show in editor based on action
      if (options.action === 'focus') {
        await vscode.window.showTextDocument(document, vscode.ViewColumn.One);
      } else if (options.action === 'background') {
        await vscode.window.showTextDocument(document, vscode.ViewColumn.Two);
      } else {
        await vscode.window.showTextDocument(document);
      }

      return {
        success: true,
        fileBufferId: this.generateBufferId(uri),
        isNewTab: !existingTab
      };

    } catch (error) {
      return {
        success: false,
        error: `Failed to open file: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Open multiple files
   */
  static async openMultipleFiles(
    filePaths: string[],
    options: { action?: 'open' | 'focus' | 'background' } = {}
  ): Promise<{ success: boolean; results: Array<{ filePath: string; success: boolean; isNewTab: boolean }> }> {
    const results = [];
    
    for (const filePath of filePaths) {
      const result = await this.openFile(filePath, options);
      results.push({
        filePath,
        success: result.success,
        isNewTab: result.isNewTab || false
      });
    }

    return {
      success: results.every(r => r.success),
      results
    };
  }

  /**
   * Get current active editor
   */
  static getActiveEditor(): vscode.TextEditor | undefined {
    return vscode.window.activeTextEditor;
  }

  /**
   * Get all open text documents
   */
  static getAllOpenDocuments(): vscode.TextDocument[] {
    return [...vscode.workspace.textDocuments];
  }

  /**
   * Get document by file path
   */
  static getDocumentByPath(filePath: string): vscode.TextDocument | undefined {
    const uri = vscode.Uri.file(filePath);
    return vscode.workspace.textDocuments.find(doc => doc.uri.fsPath === filePath);
  }

  /**
   * Apply text changes to document
   */
  static async applyTextChanges(
    document: vscode.TextDocument,
    changes: Array<{
      range: vscode.Range;
      text: string;
    }>
  ): Promise<boolean> {
    try {
      const editor = await vscode.window.showTextDocument(document);
      const edit = new vscode.WorkspaceEdit();
      
      for (const change of changes) {
        edit.replace(document.uri, change.range, change.text);
      }

      const success = await vscode.workspace.applyEdit(edit);
      return success;
    } catch (error) {
      console.error('Failed to apply text changes:', error);
      return false;
    }
  }

  /**
   * Create diff preview document
   */
  static async createDiffPreview(
    originalContent: string,
    modifiedContent: string,
    title: string
  ): Promise<vscode.TextDocument> {
    const diffUri = vscode.Uri.parse(`${this.DIFF_SCHEME}://${title}.diff`);
    const diffContent = this.createDiffContent(originalContent, modifiedContent);
    
    await vscode.workspace.fs.writeFile(diffUri, Buffer.from(diffContent, 'utf8'));
    return await vscode.workspace.openTextDocument(diffUri);
  }

  /**
   * Register diff-related commands
   */
  static registerCommands(context: vscode.ExtensionContext): void {
    const commands = [
      vscode.commands.registerCommand('diffSystem.acceptCurrent', () => {
        this.acceptCurrentDiff();
      }),
      vscode.commands.registerCommand('diffSystem.rejectCurrent', () => {
        this.rejectCurrentDiff();
      }),
      vscode.commands.registerCommand('diffSystem.acceptAll', () => {
        this.acceptAllDiffs();
      }),
      vscode.commands.registerCommand('diffSystem.rejectAll', () => {
        this.rejectAllDiffs();
      }),
      vscode.commands.registerCommand('diffSystem.clearSession', () => {
        this.clearSession();
      })
    ];

    context.subscriptions.push(...commands);
  }

  /**
   * Show information message
   */
  static showInfo(message: string): void {
    vscode.window.showInformationMessage(message);
  }

  /**
   * Show error message
   */
  static showError(message: string): void {
    vscode.window.showErrorMessage(message);
  }

  /**
   * Show warning message
   */
  static showWarning(message: string): void {
    vscode.window.showWarningMessage(message);
  }

  /**
   * Generate unique buffer ID
   */
  private static generateBufferId(uri: vscode.Uri): string {
    return `buffer_${uri.fsPath}_${Date.now()}`;
  }

  /**
   * Create diff content for preview
   */
  private static createDiffContent(original: string, modified: string): string {
    // Simple diff preview - in real implementation, 
    // this would use more sophisticated diff rendering
    const lines = [];
    lines.push('--- Original');
    lines.push('+++ Modified');
    lines.push('@@ -1,1 +1,1 @@');
    
    const originalLines = original.split('\n');
    const modifiedLines = modified.split('\n');
    
    // Simple line-by-line comparison
    for (let i = 0; i < Math.max(originalLines.length, modifiedLines.length); i++) {
      const originalLine = originalLines[i];
      const modifiedLine = modifiedLines[i];
      
      if (originalLine === modifiedLine) {
        lines.push(` ${originalLine || ''}`);
      } else if (!originalLine && modifiedLine) {
        lines.push(`+${modifiedLine}`);
      } else if (originalLine && !modifiedLine) {
        lines.push(`-${originalLine}`);
      } else {
        lines.push(`-${originalLine}`);
        lines.push(`+${modifiedLine}`);
      }
    }
    
    return lines.join('\n');
  }

  /**
   * Accept current diff (placeholder)
   */
  private static async acceptCurrentDiff(): Promise<void> {
    const activeEditor = this.getActiveEditor();
    if (activeEditor) {
      this.showInfo('Diff accepted');
      // Implementation would merge accepted changes
    }
  }

  /**
   * Reject current diff (placeholder)
   */
  private static async rejectCurrentDiff(): Promise<void> {
    const activeEditor = this.getActiveEditor();
    if (activeEditor) {
      this.showInfo('Diff rejected');
      // Implementation would remove diff overlay
    }
  }

  /**
   * Accept all diffs (placeholder)
   */
  private static async acceptAllDiffs(): Promise<void> {
    this.showInfo('All diffs accepted');
    // Implementation would accept all pending diffs
  }

  /**
   * Reject all diffs (placeholder)
   */
  private static async rejectAllDiffs(): Promise<void> {
    this.showInfo('All diffs rejected');
    // Implementation would reject all pending diffs
  }

  /**
   * Clear session (placeholder)
   */
  private static async clearSession(): Promise<void> {
    this.showInfo('Session cleared');
    // Implementation would clear all diff state
  }
}
