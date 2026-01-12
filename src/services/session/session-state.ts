/**
 * Session State Management Framework
 * 
 * Manages AI modification state across files using VSCode's Memento API
 * for persistence and in-memory for active operations
 */

import * as vscode from 'vscode';
import { SessionState, FileState, SessionSettings, SessionEvent } from '../../types/session-types';
import { DiffEvent } from '../../types/diff-types';

/**
 * Session state manager with persistence and in-memory coordination
 */
export class SessionStateManager {
  private static readonly SESSION_KEY = 'diffSystem.session';
  private static instance: SessionStateManager;
  
  private currentSession: SessionState | null = null;
  private eventListeners: Array<(event: SessionEvent) => void> = [];

  constructor(private readonly context: vscode.ExtensionContext) {}

  /**
   * Get singleton instance
   */
  static getInstance(context: vscode.ExtensionContext): SessionStateManager {
    if (!SessionStateManager.instance) {
      SessionStateManager.instance = new SessionStateManager(context);
    }
    return SessionStateManager.instance;
  }

  /**
   * Initialize or restore session state
   */
  async initialize(): Promise<void> {
    try {
      // Try to restore from persistent storage
      const stored = this.context.globalState.get<SessionState>(SessionStateManager.SESSION_KEY);
      
      if (stored) {
        this.currentSession = {
          ...stored,
          createdAt: new Date(stored.createdAt),
          lastActivity: new Date(stored.lastActivity),
          fileStates: new Map(Object.entries(stored.fileStates || {}))
        };
      } else {
        // Create new session
        this.currentSession = this.createNewSession();
      }

      console.log('Session state initialized:', this.currentSession.id);
    } catch (error) {
      console.error('Failed to initialize session state:', error);
      this.currentSession = this.createNewSession();
    }
  }

  /**
   * Get current session state
   */
  getCurrentSession(): SessionState | null {
    return this.currentSession;
  }

  /**
   * Update session settings
   */
  async updateSettings(settings: Partial<SessionSettings>): Promise<void> {
    if (!this.currentSession) return;

    this.currentSession.globalSettings = {
      ...this.currentSession.globalSettings,
      ...settings
    };

    await this.persistSession();
    this.emitEvent({
      type: 'session_updated',
      sessionId: this.currentSession.id,
      data: settings
    });
  }

  /**
   * Add file state to session
   */
  async addFileState(filePath: string, fileState: Omit<FileState, 'filePath'>): Promise<void> {
    if (!this.currentSession) return;

    const fullFileState: FileState = {
      filePath,
      ...fileState
    };

    this.currentSession.fileStates.set(filePath, fullFileState);
    await this.persistSession();

    this.emitEvent({
      type: 'file_added',
      sessionId: this.currentSession.id,
      data: { filePath, newState: fullFileState }
    });
  }

  /**
   * Update file state
   */
  async updateFileState(filePath: string, updates: Partial<FileState>): Promise<void> {
    if (!this.currentSession) return;

    const existing = this.currentSession.fileStates.get(filePath);
    if (!existing) return;

    const updatedState: FileState = {
      ...existing,
      ...updates
    };

    this.currentSession.fileStates.set(filePath, updatedState);
    await this.persistSession();

    this.emitEvent({
      type: 'file_state_changed',
      sessionId: this.currentSession.id,
      data: { filePath, previousState: existing, newState: updatedState }
    });
  }

  /**
   * Remove file state from session
   */
  async removeFileState(filePath: string): Promise<void> {
    if (!this.currentSession) return;

    const existing = this.currentSession.fileStates.get(filePath);
    if (existing) {
      this.currentSession.fileStates.delete(filePath);
      await this.persistSession();

      this.emitEvent({
        type: 'file_removed',
        sessionId: this.currentSession.id,
        data: { filePath, previousState: existing }
      });
    }
  }

  /**
   * Add shadow buffer to active list
   */
  async addShadowBuffer(shadowBufferId: string): Promise<void> {
    if (!this.currentSession) return;

    if (!this.currentSession.activeShadowBuffers.includes(shadowBufferId)) {
      this.currentSession.activeShadowBuffers.push(shadowBufferId);
      await this.persistSession();
    }
  }

  /**
   * Remove shadow buffer from active list
   */
  async removeShadowBuffer(shadowBufferId: string): Promise<void> {
    if (!this.currentSession) return;

    const index = this.currentSession.activeShadowBuffers.indexOf(shadowBufferId);
    if (index > -1) {
      this.currentSession.activeShadowBuffers.splice(index, 1);
      await this.persistSession();
    }
  }

  /**
   * Get file state by path
   */
  getFileState(filePath: string): FileState | undefined {
    return this.currentSession?.fileStates.get(filePath);
  }

  /**
   * Get all file states
   */
  getAllFileStates(): Map<string, FileState> {
    return new Map(this.currentSession?.fileStates || []);
  }

  /**
   * Clear all session data
   */
  async clearSession(): Promise<void> {
    const oldSession = this.currentSession;
    
    this.currentSession = this.createNewSession();
    await this.persistSession();

    this.emitEvent({
      type: 'session_cleared',
      sessionId: this.currentSession.id,
      data: { previousSessionId: oldSession?.id }
    });
  }

  /**
   * Add event listener
   */
  addEventListener(listener: (event: SessionEvent) => void): void {
    this.eventListeners.push(listener);
  }

  /**
   * Remove event listener
   */
  removeEventListener(listener: (event: SessionEvent) => void): void {
    const index = this.eventListeners.indexOf(listener);
    if (index > -1) {
      this.eventListeners.splice(index, 1);
    }
  }

  /**
   * Get session statistics
   */
  getSessionStats(): {
    totalFiles: number;
    activeDiffs: number;
    sessionAge: number;
    lastActivity: Date | null;
  } {
    if (!this.currentSession) {
      return {
        totalFiles: 0,
        activeDiffs: 0,
        sessionAge: 0,
        lastActivity: null
      };
    }

    const totalFiles = this.currentSession.fileStates.size;
    const activeDiffs = this.currentSession.activeShadowBuffers.length;
    const sessionAge = Date.now() - this.currentSession.createdAt.getTime();
    const lastActivity = this.currentSession.lastActivity;

    return {
      totalFiles,
      activeDiffs,
      sessionAge,
      lastActivity
    };
  }

  /**
   * Persist session to VSCode global state
   */
  private async persistSession(): Promise<void> {
    if (!this.currentSession) return;

    try {
      // Convert Map to plain object for serialization
      const serializableSession = {
        ...this.currentSession,
        fileStates: Object.fromEntries(this.currentSession.fileStates),
        lastActivity: this.currentSession.lastActivity.toISOString(),
        createdAt: this.currentSession.createdAt.toISOString()
      };

      await this.context.globalState.update(SessionStateManager.SESSION_KEY, serializableSession);
    } catch (error) {
      console.error('Failed to persist session state:', error);
    }
  }

  /**
   * Create new session with default settings
   */
  private createNewSession(): SessionState {
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    return {
      id: sessionId,
      activeShadowBuffers: [],
      fileStates: new Map(),
      globalSettings: {
        autoSave: false,
        diffColorScheme: 'vscode',
        maxFileSize: 10485760, // 10MB
        streamingChunkSize: 65536 // 64KB
      },
      createdAt: new Date(),
      lastActivity: new Date()
    };
  }

  /**
   * Emit event to all listeners
   */
  private emitEvent(event: Omit<SessionEvent, 'timestamp'>): void {
    const fullEvent: SessionEvent = {
      ...event,
      timestamp: new Date()
    };
    
    this.eventListeners.forEach(listener => {
      try {
        listener(fullEvent);
      } catch (error) {
        console.error('Error in session event listener:', error);
      }
    });
  }
}
