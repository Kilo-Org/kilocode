/**
 * Tab Manager Service
 * 
 * Manages multi-file tab coordination and organization for AI-driven workflows
 */

import * as vscode from 'vscode';
import { Logger } from '../error-handler';

export interface TabInfo {
  filePath: string;
  fileBufferId: string;
  editor: vscode.TextEditor;
  viewColumn: vscode.ViewColumn;
  isActive: boolean;
  isVisible: boolean;
  openedAt: Date;
  lastAccessedAt: Date;
}

export interface TabGroup {
  id: string;
  name: string;
  tabs: TabInfo[];
  activeTab?: string;
  createdAt: Date;
}

/**
 * Tab manager for coordinating multi-file workflows
 */
export class TabManagerService {
  private activeTabs: Map<string, TabInfo> = new Map();
  private tabGroups: Map<string, TabGroup> = new Map();
  private workspaceRoot: string;

  constructor() {
    // Detect workspace root
    const workspaceFolders = vscode.workspace.workspaceFolders;
    this.workspaceRoot = workspaceFolders?.[0]?.uri.fsPath || '';
  }

  /**
   * Initialize service
   */
  async initialize(): Promise<void> {
    try {
      // Register event listeners
      vscode.window.onDidChangeActiveTextEditor(this.onActiveEditorChanged.bind(this));
      vscode.window.onDidChangeVisibleTextEditors(this.onVisibleEditorsChanged.bind(this));
      vscode.window.onDidChangeTextEditorSelection(this.onSelectionChanged.bind(this));
      vscode.window.onDidChangeTextEditorVisibleRanges(this.onVisibleRangesChanged.bind(this));

      // Restore existing tabs
      await this.restoreExistingTabs();

      Logger.info('TabManagerService.initialize', 'Tab manager service initialized');
    } catch (error) {
      Logger.error('TabManagerService.initialize', 'Failed to initialize tab manager service', error);
    }
  }

  /**
   * Create or get tab info for editor
   */
  async createTabInfo(editor: vscode.TextEditor, fileBufferId?: string): Promise<TabInfo> {
    const filePath = editor.document.uri.fsPath;
    const existingTab = this.activeTabs.get(filePath);

    if (existingTab) {
      // Update existing tab
      existingTab.lastAccessedAt = new Date();
      existingTab.isActive = editor === vscode.window.activeTextEditor;
      existingTab.isVisible = vscode.window.visibleTextEditors.includes(editor);
      return existingTab;
    }

    // Create new tab info
    const tabInfo: TabInfo = {
      filePath,
      fileBufferId: fileBufferId || this.generateFileBufferId(filePath),
      editor,
      viewColumn: editor.viewColumn || vscode.ViewColumn.One,
      isActive: editor === vscode.window.activeTextEditor,
      isVisible: vscode.window.visibleTextEditors.includes(editor),
      openedAt: new Date(),
      lastAccessedAt: new Date()
    };

    this.activeTabs.set(filePath, tabInfo);
    return tabInfo;
  }

  /**
   * Get tab info by file path
   */
  getTabInfo(filePath: string): TabInfo | undefined {
    return this.activeTabs.get(filePath);
  }

  /**
   * Get all active tabs
   */
  getAllTabs(): TabInfo[] {
    return Array.from(this.activeTabs.values());
  }

  /**
   * Get visible tabs
   */
  getVisibleTabs(): TabInfo[] {
    return this.getAllTabs().filter(tab => tab.isVisible);
  }

  /**
   * Get active tab
   */
  getActiveTab(): TabInfo | undefined {
    return this.getAllTabs().find(tab => tab.isActive);
  }

  /**
   * Focus tab by file path
   */
  async focusTab(filePath: string): Promise<boolean> {
    try {
      const tabInfo = this.activeTabs.get(filePath);
      if (!tabInfo) {
        return false;
      }

      await vscode.window.showTextDocument(tabInfo.editor.document, tabInfo.viewColumn);
      return true;
    } catch (error) {
      Logger.error('TabManagerService.focusTab', `Failed to focus tab: ${filePath}`, error);
      return false;
    }
  }

  /**
   * Close tab by file path
   */
  async closeTab(filePath: string): Promise<boolean> {
    try {
      const tabInfo = this.activeTabs.get(filePath);
      if (!tabInfo) {
        return false;
      }

      // Close the editor
      await vscode.window.showTextDocument(tabInfo.editor.document);
      await vscode.commands.executeCommand('workbench.action.closeActiveEditor');

      // Remove from tracking
      this.activeTabs.delete(filePath);

      Logger.info('TabManagerService.closeTab', `Closed tab: ${filePath}`);
      return true;
    } catch (error) {
      Logger.error('TabManagerService.closeTab', `Failed to close tab: ${filePath}`, error);
      return false;
    }
  }

  /**
   * Create tab group for organized workflow
   */
  createTabGroup(name: string, filePaths: string[]): TabGroup {
    const groupId = this.generateGroupId(name);
    const tabs: TabInfo[] = [];

    for (const filePath of filePaths) {
      const tabInfo = this.activeTabs.get(filePath);
      if (tabInfo) {
        tabs.push(tabInfo);
      }
    }

    const tabGroup: TabGroup = {
      id: groupId,
      name,
      tabs,
      createdAt: new Date()
    };

    this.tabGroups.set(groupId, tabGroup);
    Logger.info('TabManagerService.createTabGroup', `Created tab group: ${name} with ${tabs.length} tabs`);
    
    return tabGroup;
  }

  /**
   * Get tab group by ID
   */
  getTabGroup(groupId: string): TabGroup | undefined {
    return this.tabGroups.get(groupId);
  }

  /**
   * Get all tab groups
   */
  getAllTabGroups(): TabGroup[] {
    return Array.from(this.tabGroups.values());
  }

  /**
   * Focus tab group (bring all tabs to visible editors)
   */
  async focusTabGroup(groupId: string): Promise<boolean> {
    try {
      const tabGroup = this.tabGroups.get(groupId);
      if (!tabGroup || tabGroup.tabs.length === 0) {
        return false;
      }

      // Show tabs in available view columns
      const viewColumns = [vscode.ViewColumn.One, vscode.ViewColumn.Two, vscode.ViewColumn.Three];
      
      for (let i = 0; i < Math.min(tabGroup.tabs.length, viewColumns.length); i++) {
        const tab = tabGroup.tabs[i];
        await vscode.window.showTextDocument(tab.editor.document, viewColumns[i]);
      }

      // Focus the first tab
      if (tabGroup.tabs.length > 0) {
        await this.focusTab(tabGroup.tabs[0].filePath);
      }

      Logger.info('TabManagerService.focusTabGroup', `Focused tab group: ${tabGroup.name}`);
      return true;
    } catch (error) {
      Logger.error('TabManagerService.focusTabGroup', `Failed to focus tab group: ${groupId}`, error);
      return false;
    }
  }

  /**
   * Close tab group
   */
  async closeTabGroup(groupId: string): Promise<boolean> {
    try {
      const tabGroup = this.tabGroups.get(groupId);
      if (!tabGroup) {
        return false;
      }

      // Close all tabs in the group
      for (const tab of tabGroup.tabs) {
        await this.closeTab(tab.filePath);
      }

      // Remove group
      this.tabGroups.delete(groupId);

      Logger.info('TabManagerService.closeTabGroup', `Closed tab group: ${tabGroup.name}`);
      return true;
    } catch (error) {
      Logger.error('TabManagerService.closeTabGroup', `Failed to close tab group: ${groupId}`, error);
      return false;
    }
  }

  /**
   * Arrange tabs in grid layout for multi-file viewing
   */
  async arrangeTabsInGrid(filePaths: string[]): Promise<boolean> {
    try {
      const viewColumns = [
        vscode.ViewColumn.One,
        vscode.ViewColumn.Two,
        vscode.ViewColumn.Three,
        vscode.ViewColumn.Active // Fallback for additional tabs
      ];

      for (let i = 0; i < filePaths.length; i++) {
        const filePath = filePaths[i];
        const tabInfo = this.activeTabs.get(filePath);
        
        if (tabInfo) {
          const viewColumn = viewColumns[i % viewColumns.length];
          await vscode.window.showTextDocument(tabInfo.editor.document, viewColumn);
        }
      }

      Logger.info('TabManagerService.arrangeTabsInGrid', `Arranged ${filePaths.length} tabs in grid layout`);
      return true;
    } catch (error) {
      Logger.error('TabManagerService.arrangeTabsInGrid', 'Failed to arrange tabs in grid', error);
      return false;
    }
  }

  /**
   * Get tab statistics
   */
  getTabStats(): {
    totalTabs: number;
    visibleTabs: number;
    activeTabs: number;
    tabGroups: number;
  } {
    const allTabs = this.getAllTabs();
    const visibleTabs = this.getVisibleTabs();
    const activeTabs = allTabs.filter(tab => tab.isActive);

    return {
      totalTabs: allTabs.length,
      visibleTabs: visibleTabs.length,
      activeTabs: activeTabs.length,
      tabGroups: this.tabGroups.size
    };
  }

  /**
   * Restore existing tabs from workspace
   */
  private async restoreExistingTabs(): Promise<void> {
    try {
      const visibleEditors = vscode.window.visibleTextEditors;
      
      for (const editor of visibleEditors) {
        if (editor.document) {
          await this.createTabInfo(editor);
        }
      }
      
      Logger.info('TabManagerService.restoreExistingTabs', `Restored ${this.activeTabs.size} existing tabs`);
    } catch (error) {
      Logger.error('TabManagerService.restoreExistingTabs', 'Failed to restore existing tabs', error);
    }
  }

  /**
   * Generate file buffer ID
   */
  private generateFileBufferId(filePath: string): string {
    return `buffer_${filePath.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}`;
  }

  /**
   * Generate group ID
   */
  private generateGroupId(name: string): string {
    return `group_${name.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}`;
  }

  /**
   * Handle active editor changed
   */
  private onActiveEditorChanged(editor: vscode.TextEditor | undefined): void {
    try {
      // Update all tabs to inactive
      for (const tab of this.activeTabs.values()) {
        tab.isActive = false;
      }

      // Set new active tab
      if (editor && editor.document) {
        const filePath = editor.document.uri.fsPath;
        const tabInfo = this.activeTabs.get(filePath);
        
        if (tabInfo) {
          tabInfo.isActive = true;
          tabInfo.lastAccessedAt = new Date();
        } else {
          // Create new tab info for newly activated editor
          this.createTabInfo(editor);
        }
      }
    } catch (error) {
      Logger.error('TabManagerService.onActiveEditorChanged', 'Error handling active editor change', error);
    }
  }

  /**
   * Handle visible editors changed
   */
  private onVisibleEditorsChanged(editors: readonly vscode.TextEditor[]): void {
    try {
      // Update visibility for all tabs
      for (const tab of this.activeTabs.values()) {
        tab.isVisible = editors.includes(tab.editor);
      }

      // Create tab info for newly visible editors
      for (const editor of editors) {
        if (editor.document) {
          const filePath = editor.document.uri.fsPath;
          if (!this.activeTabs.has(filePath)) {
            this.createTabInfo(editor);
          }
        }
      }
    } catch (error) {
      Logger.error('TabManagerService.onVisibleEditorsChanged', 'Error handling visible editors change', error);
    }
  }

  /**
   * Handle selection changed
   */
  private onSelectionChanged(event: vscode.TextEditorSelectionChangeEvent): void {
    try {
      const filePath = event.textEditor.document.uri.fsPath;
      const tabInfo = this.activeTabs.get(filePath);
      
      if (tabInfo) {
        tabInfo.lastAccessedAt = new Date();
      }
    } catch (error) {
      Logger.error('TabManagerService.onSelectionChanged', 'Error handling selection change', error);
    }
  }

  /**
   * Handle visible ranges changed
   */
  private onVisibleRangesChanged(event: vscode.TextEditorVisibleRangesChangeEvent): void {
    try {
      const filePath = event.textEditor.document.uri.fsPath;
      const tabInfo = this.activeTabs.get(filePath);
      
      if (tabInfo) {
        tabInfo.lastAccessedAt = new Date();
      }
    } catch (error) {
      Logger.error('TabManagerService.onVisibleRangesChanged', 'Error handling visible ranges change', error);
    }
  }
}
