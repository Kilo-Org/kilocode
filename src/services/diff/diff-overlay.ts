/**
 * Diff Overlay Manager
 * 
 * Manages diff overlays for visualization and interaction
 */

import * as vscode from 'vscode';
import { DiffOverlay } from '../../types/diff-types';
import { DiffOverlayEntity } from '../../entities/diff-overlay';
import { Logger } from '../error-handler';
import { DiffEventManager } from '../event-system';

/**
 * Manages diff overlays for a specific file
 */
export class DiffOverlayManager {
  private overlays: Map<string, DiffOverlay[]> = new Map();
  private decorations: Map<string, vscode.TextEditorDecorationType[]> = new Map();
  private activeEditor: vscode.TextEditor | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {}

  /**
   * Initialize overlay manager
   */
  initialize(): void {
    // Register event listeners
    DiffEventManager.onDiffCreated(this.onDiffCreated.bind(this));
    DiffEventManager.onDiffAccepted(this.onDiffAccepted.bind(this));
    DiffEventManager.onDiffRejected(this.onDiffRejected.bind(this));

    // Register editor change listeners
    vscode.window.onDidChangeActiveTextEditor(this.onActiveEditorChanged.bind(this));
    vscode.workspace.onDidChangeTextDocument(this.onDocumentChanged.bind(this));
  }

  /**
   * Add overlays for a file
   */
  addOverlays(fileBufferId: string, overlays: DiffOverlay[]): void {
    try {
      this.overlays.set(fileBufferId, overlays);
      
      // Update decorations if editor is active
      if (this.activeEditor && this.getFileBufferId(this.activeEditor) === fileBufferId) {
        this.updateDecorations(fileBufferId);
      }

      Logger.debug('DiffOverlayManager.addOverlays', `Added ${overlays.length} overlays for ${fileBufferId}`);
    } catch (error) {
      Logger.error('DiffOverlayManager.addOverlays', 'Failed to add overlays', error);
    }
  }

  /**
   * Remove overlays for a file
   */
  removeOverlays(fileBufferId: string): void {
    try {
      this.overlays.delete(fileBufferId);
      this.clearDecorations(fileBufferId);

      Logger.debug('DiffOverlayManager.removeOverlays', `Removed overlays for ${fileBufferId}`);
    } catch (error) {
      Logger.error('DiffOverlayManager.removeOverlays', 'Failed to remove overlays', error);
    }
  }

  /**
   * Update overlay state
   */
  updateOverlay(overlayId: string, updates: Partial<DiffOverlay>): void {
    try {
      for (const [fileBufferId, overlays] of this.overlays.entries()) {
        const overlayIndex = overlays.findIndex(o => o.id === overlayId);
        if (overlayIndex !== -1) {
          overlays[overlayIndex] = { ...overlays[overlayIndex], ...updates };
          this.overlays.set(fileBufferId, overlays);
          
          // Update decorations if this file is active
          if (this.activeEditor && this.getFileBufferId(this.activeEditor) === fileBufferId) {
            this.updateDecorations(fileBufferId);
          }
          
          break;
        }
      }
    } catch (error) {
      Logger.error('DiffOverlayManager.updateOverlay', 'Failed to update overlay', error);
    }
  }

  /**
   * Accept overlay
   */
  acceptOverlay(overlayId: string): boolean {
    try {
      const overlay = this.findOverlay(overlayId);
      if (!overlay) {
        return false;
      }

      // Update overlay state
      const acceptedOverlay = DiffOverlayEntity.markAccepted(overlay);
      this.updateOverlay(overlayId, acceptedOverlay);

      // Emit event
      DiffEventManager.emitDiffAccepted({
        data: { overlayId, fileBufferId: this.getFileBufferIdForOverlay(overlayId) },
        timestamp: new Date()
      });

      // Update decorations
      this.updateDecorationsForOverlay(overlayId);

      Logger.debug('DiffOverlayManager.acceptOverlay', `Accepted overlay ${overlayId}`);
      return true;
    } catch (error) {
      Logger.error('DiffOverlayManager.acceptOverlay', 'Failed to accept overlay', error);
      return false;
    }
  }

  /**
   * Reject overlay
   */
  rejectOverlay(overlayId: string): boolean {
    try {
      const overlay = this.findOverlay(overlayId);
      if (!overlay) {
        return false;
      }

      // Update overlay state
      const rejectedOverlay = DiffOverlayEntity.markRejected(overlay);
      this.updateOverlay(overlayId, rejectedOverlay);

      // Emit event
      DiffEventManager.emitDiffRejected({
        data: { overlayId, fileBufferId: this.getFileBufferIdForOverlay(overlayId) },
        timestamp: new Date()
      });

      // Update decorations
      this.updateDecorationsForOverlay(overlayId);

      Logger.debug('DiffOverlayManager.rejectOverlay', `Rejected overlay ${overlayId}`);
      return true;
    } catch (error) {
      Logger.error('DiffOverlayManager.rejectOverlay', 'Failed to reject overlay', error);
      return false;
    }
  }

  /**
   * Accept all overlays for a file
   */
  acceptAllOverlays(fileBufferId: string): number {
    try {
      const overlays = this.overlays.get(fileBufferId) || [];
      let acceptedCount = 0;

      for (const overlay of overlays) {
        if (!overlay.isAccepted && !overlay.isRejected) {
          if (this.acceptOverlay(overlay.id)) {
            acceptedCount++;
          }
        }
      }

      Logger.debug('DiffOverlayManager.acceptAllOverlays', `Accepted ${acceptedCount} overlays for ${fileBufferId}`);
      return acceptedCount;
    } catch (error) {
      Logger.error('DiffOverlayManager.acceptAllOverlays', 'Failed to accept all overlays', error);
      return 0;
    }
  }

  /**
   * Reject all overlays for a file
   */
  rejectAllOverlays(fileBufferId: string): number {
    try {
      const overlays = this.overlays.get(fileBufferId) || [];
      let rejectedCount = 0;

      for (const overlay of overlays) {
        if (!overlay.isAccepted && !overlay.isRejected) {
          if (this.rejectOverlay(overlay.id)) {
            rejectedCount++;
          }
        }
      }

      Logger.debug('DiffOverlayManager.rejectAllOverlays', `Rejected ${rejectedCount} overlays for ${fileBufferId}`);
      return rejectedCount;
    } catch (error) {
      Logger.error('DiffOverlayManager.rejectAllOverlays', 'Failed to reject all overlays', error);
      return 0;
    }
  }

  /**
   * Get overlays for a file
   */
  getOverlays(fileBufferId: string): DiffOverlay[] {
    return this.overlays.get(fileBufferId) || [];
  }

  /**
   * Get overlay statistics
   */
  getOverlayStats(fileBufferId: string): {
    total: number;
    accepted: number;
    rejected: number;
    pending: number;
  } {
    const overlays = this.overlays.get(fileBufferId) || [];
    
    return {
      total: overlays.length,
      accepted: overlays.filter(o => o.isAccepted).length,
      rejected: overlays.filter(o => o.isRejected).length,
      pending: overlays.filter(o => !o.isAccepted && !o.isRejected).length
    };
  }

  /**
   * Clear all overlays
   */
  clearAll(): void {
    try {
      // Clear all decorations
      for (const fileBufferId of this.decorations.keys()) {
        this.clearDecorations(fileBufferId);
      }

      // Clear overlays
      this.overlays.clear();
      this.decorations.clear();

      Logger.debug('DiffOverlayManager.clearAll', 'Cleared all overlays');
    } catch (error) {
      Logger.error('DiffOverlayManager.clearAll', 'Failed to clear overlays', error);
    }
  }

  /**
   * Handle diff created event
   */
  private onDiffCreated(event: any): void {
    if (event.data.overlays) {
      this.addOverlays(event.data.fileBufferId, event.data.overlays);
    }
  }

  /**
   * Handle diff accepted event
   */
  private onDiffAccepted(event: any): void {
    this.updateDecorationsForOverlay(event.data.overlayId);
  }

  /**
   * Handle diff rejected event
   */
  private onDiffRejected(event: any): void {
    this.updateDecorationsForOverlay(event.data.overlayId);
  }

  /**
   * Handle active editor change
   */
  private onActiveEditorChanged(editor: vscode.TextEditor | undefined): void {
    this.activeEditor = editor;
    
    if (editor) {
      const fileBufferId = this.getFileBufferId(editor);
      if (fileBufferId && this.overlays.has(fileBufferId)) {
        this.updateDecorations(fileBufferId);
      }
    }
  }

  /**
   * Handle document change
   */
  private onDocumentChanged(event: vscode.TextDocumentChangeEvent): void {
    const document = event.document;
    const fileBufferId = this.getDocumentFileBufferId(document);
    
    if (fileBufferId && this.overlays.has(fileBufferId)) {
      // Clear decorations when document changes
      this.clearDecorations(fileBufferId);
    }
  }

  /**
   * Update decorations for a file
   */
  private updateDecorations(fileBufferId: string): void {
    const editor = this.activeEditor;
    if (!editor || this.getFileBufferId(editor) !== fileBufferId) {
      return;
    }

    const overlays = this.overlays.get(fileBufferId) || [];
    const decorations = this.createDecorations(overlays);
    
    // Apply decorations
    editor.setDecorations(decorations);
    
    // Store decoration types for cleanup
    this.decorations.set(fileBufferId, decorations.map(d => d.decorationType));
  }

  /**
   * Update decorations for specific overlay
   */
  private updateDecorationsForOverlay(overlayId: string): void {
    for (const [fileBufferId, overlays] of this.overlays.entries()) {
      const overlay = overlays.find(o => o.id === overlayId);
      if (overlay) {
        this.updateDecorations(fileBufferId);
        break;
      }
    }
  }

  /**
   * Clear decorations for a file
   */
  private clearDecorations(fileBufferId: string): void {
    const editor = this.activeEditor;
    if (!editor || this.getFileBufferId(editor) !== fileBufferId) {
      return;
    }

    editor.setDecorations([]);
    this.decorations.delete(fileBufferId);
  }

  /**
   * Create VSCode decorations from overlays
   */
  private createDecorations(overlays: DiffOverlay[]): vscode.DecorationOptions[] {
    const decorations: vscode.DecorationOptions[] = [];

    for (const overlay of overlays) {
      const decoration = this.createDecoration(overlay);
      if (decoration) {
        decorations.push(decoration);
      }
    }

    return decorations;
  }

  /**
   * Create decoration for single overlay
   */
  private createDecoration(overlay: DiffOverlay): vscode.DecorationOptions | null {
    try {
      const range = new vscode.Range(
        overlay.startLine,
        0,
        overlay.endLine,
        0
      );

      let decorationType: vscode.TextEditorDecorationType;
      let renderOptions: vscode.DecorationRenderOptions;

      if (overlay.type === 'addition') {
        decorationType = vscode.window.createTextEditorDecorationType({
          backgroundColor: 'rgba(0, 255, 0, 0.1)',
          border: '1px solid rgba(0, 255, 0, 0.3)',
          borderRadius: '2px'
        });
        renderOptions = {
          before: {
            contentText: '+',
            color: '#00ff00',
            fontWeight: 'bold'
          }
        };
      } else if (overlay.type === 'deletion') {
        decorationType = vscode.window.createTextEditorDecorationType({
          backgroundColor: 'rgba(255, 0, 0, 0.1)',
          border: '1px solid rgba(255, 0, 0, 0.3)',
          borderRadius: '2px',
          textDecoration: 'line-through'
        });
        renderOptions = {
          before: {
            contentText: '-',
            color: '#ff0000',
            fontWeight: 'bold'
          }
        };
      } else if (overlay.type === 'modification') {
        decorationType = vscode.window.createTextEditorDecorationType({
          backgroundColor: 'rgba(255, 255, 0, 0.1)',
          border: '1px solid rgba(255, 255, 0, 0.3)',
          borderRadius: '2px'
        });
        renderOptions = {
          before: {
            contentText: '~',
            color: '#ffff00',
            fontWeight: 'bold'
          }
        };
      } else {
        return null;
      }

      // Adjust decoration based on acceptance state
      if (overlay.isAccepted) {
        renderOptions.backgroundColor = 'rgba(0, 255, 0, 0.05)';
        renderOptions.border = '1px solid rgba(0, 255, 0, 0.2)';
      } else if (overlay.isRejected) {
        renderOptions.backgroundColor = 'rgba(255, 0, 0, 0.05)';
        renderOptions.border = '1px solid rgba(255, 0, 0, 0.2)';
        renderOptions.opacity = '0.5';
      }

      return {
        range,
        decorationType,
        renderOptions
      };
    } catch (error) {
      Logger.error('DiffOverlayManager.createDecoration', 'Failed to create decoration', error);
      return null;
    }
  }

  /**
   * Find overlay by ID
   */
  private findOverlay(overlayId: string): DiffOverlay | undefined {
    for (const overlays of this.overlays.values()) {
      const overlay = overlays.find(o => o.id === overlayId);
      if (overlay) {
        return overlay;
      }
    }
    return undefined;
  }

  /**
   * Get file buffer ID from editor
   */
  private getFileBufferId(editor: vscode.TextEditor): string | undefined {
    return editor.document.uri.fsPath;
  }

  /**
   * Get file buffer ID from document
   */
  private getDocumentFileBufferId(document: vscode.TextDocument): string | undefined {
    return document.uri.fsPath;
  }

  /**
   * Get file buffer ID for overlay
   */
  private getFileBufferIdForOverlay(overlayId: string): string | undefined {
    for (const [fileBufferId, overlays] of this.overlays.entries()) {
      if (overlays.some(o => o.id === overlayId)) {
        return fileBufferId;
      }
    }
    return undefined;
  }
}
