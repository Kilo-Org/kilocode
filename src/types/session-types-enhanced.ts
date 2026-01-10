/**
 * SessionState Entity Enhancement
 * 
 * Extends session types for multi-file coordination
 */

import { SessionState, SessionSettings } from '../../types/session-types';

/**
 * Enhanced session state with multi-file support
 */
export class SessionStateEntity {
  /**
   * Create new session state
   */
  static create(
    id: string,
    activeShadowBuffers: string[] = [],
    fileStates: Map<string, any> = new Map(),
    globalSettings: SessionSettings = {
      autoSave: false,
      diffColorScheme: 'vscode',
      maxFileSize: 10485760, // 10MB
      streamingChunkSize: 65536 // 64KB
    },
    createdAt: Date = new Date(),
    lastActivity: Date = new Date()
  ): SessionState {
    return {
      id,
      activeShadowBuffers,
      fileStates: new Map(fileStates),
      globalSettings,
      createdAt,
      lastActivity
    };
  }

  /**
   * Add file state to session
   */
  static addFileState(
    session: SessionState,
    filePath: string,
    fileState: any
  ): SessionState {
    const newFileStates = new Map(session.fileStates);
    newFileStates.set(filePath, fileState);
    
    return {
      ...session,
      fileStates: newFileStates,
      lastActivity: new Date()
    };
  }

  /**
   * Remove file state from session
   */
  static removeFileState(
    session: SessionState,
    filePath: string
  ): SessionState {
    const newFileStates = new Map(session.fileStates);
    newFileStates.delete(filePath);
    
    return {
      ...session,
      fileStates: newFileStates,
      lastActivity: new Date()
    };
  }

  /**
   * Update file state in session
   */
  static updateFileState(
    session: SessionState,
    filePath: string,
    updates: any
  ): SessionState {
    const newFileStates = new Map(session.fileStates);
    const existingState = session.fileStates.get(filePath);
    const updatedState = existingState ? { ...existingState, ...updates } : updates;
    newFileStates.set(filePath, updatedState);
    
    return {
      ...session,
      fileStates: newFileStates,
      lastActivity: new Date()
    };
  }

  /**
   * Add shadow buffer to session
   */
  static addShadowBuffer(
    session: SessionState,
    shadowBufferId: string
  ): SessionState {
    const newActiveShadowBuffers = [...session.activeShadowBuffers];
    if (!newActiveShadowBuffers.includes(shadowBufferId)) {
      newActiveShadowBuffers.push(shadowBufferId);
    }
    
    return {
      ...session,
      activeShadowBuffers: newActiveShadowBuffers,
      lastActivity: new Date()
    };
  }

  /**
   * Remove shadow buffer from session
   */
  static removeShadowBuffer(
    session: SessionState,
    shadowBufferId: string
  ): SessionState {
    const newActiveShadowBuffers = session.activeShadowBuffers.filter(id => id !== shadowBufferId);
    
    return {
      ...session,
      activeShadowBuffers: newActiveShadowBuffers,
      lastActivity: new Date()
    };
  }

  /**
   * Update global settings
   */
  static updateGlobalSettings(
    session: SessionState,
    settings: Partial<SessionSettings>
  ): SessionState {
    return {
      ...session,
      globalSettings: {
        ...session.globalSettings,
        ...settings
      },
      lastActivity: new Date()
    };
  }

  /**
   * Get session statistics
   */
  static getStats(session: SessionState): {
    totalFiles: number;
    activeDiffs: number;
    sessionAge: number;
    lastActivity: Date | null;
  } {
    const totalFiles = session.fileStates.size;
    const activeDiffs = session.activeShadowBuffers.length;
    const sessionAge = Date.now() - session.createdAt.getTime();
    const lastActivity = session.lastActivity;
    
    return {
      totalFiles,
      activeDiffs,
      sessionAge,
      lastActivity
    };
  }

  /**
   * Validate session state
   */
  static validate(session: SessionState): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    if (!session.id || session.id.trim() === '') {
      errors.push('Session ID is required');
    }
    
    if (!Array.isArray(session.activeShadowBuffers)) {
      errors.push('Active shadow buffers must be an array');
    }
    
    if (!(session.fileStates instanceof Map)) {
      errors.push('File states must be a Map');
    }
    
    if (session.activeShadowBuffers.some(id => typeof id !== 'string')) {
      errors.push('All shadow buffer IDs must be strings');
    }
    
    const requiredSettings = ['autoSave', 'diffColorScheme', 'maxFileSize'];
    for (const setting of requiredSettings) {
      if (!(setting in session.globalSettings)) {
        errors.push(`Missing required setting: ${setting}`);
      }
    }
    
    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Merge session states
   */
  static merge(
    baseSession: SessionState,
    updateSession: Partial<SessionState>
  ): SessionState {
    const mergedFileStates = new Map(baseSession.fileStates);
    
    // Merge file states from update session
    if (updateSession.fileStates) {
      for (const [filePath, fileState] of updateSession.fileStates.entries()) {
        mergedFileStates.set(filePath, fileState);
      }
    }
    
    return {
      ...baseSession,
      ...updateSession,
      fileStates: mergedFileStates,
      lastActivity: new Date()
    };
  }

  /**
   * Check if session has unsaved changes
   */
  static hasUnsavedChanges(session: SessionState): boolean {
    for (const fileState of session.fileStates.values()) {
      if (fileState.hasUnsavedChanges) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get files with active diffs
   */
  static getFilesWithActiveDiffs(session: SessionState): string[] {
    const filesWithDiffs: string[] = [];
    
    for (const [filePath, fileState] of session.fileStates.entries()) {
      if (fileState.activeDiffCount > 0) {
        filesWithDiffs.push(filePath);
      }
    }
    
    return filesWithDiffs;
  }

  /**
   * Get total active diff count
   */
  static getTotalActiveDiffs(session: SessionState): number {
    return session.activeShadowBuffers.length;
  }

  /**
   * Clear all active diffs
   */
  static clearAllActiveDiffs(session: SessionState): SessionState {
    return {
      ...session,
      activeShadowBuffers: [],
      lastActivity: new Date()
    };
  }
}
