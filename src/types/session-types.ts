/**
 * Session State Type Definitions
 * 
 * Types for managing AI modification state across files
 */

export interface SessionState {
  id: string;
  activeShadowBuffers: string[];
  fileStates: Map<string, FileState>;
  globalSettings: SessionSettings;
  createdAt: Date;
  lastActivity: Date;
}

export interface FileState {
  filePath: string;
  hasUnsavedChanges: boolean;
  activeDiffCount: number;
  lastSyncVersion: number;
}

export interface SessionSettings {
  autoSave: boolean;
  diffColorScheme: 'vscode' | 'custom' | 'high-contrast';
  maxFileSize: number;
  streamingChunkSize?: number;
}

export interface SessionActionResponse {
  success: boolean;
  message: string;
  clearedBuffers?: number;
}

// Session events
export interface SessionEvent {
  type: 'session_created' | 'session_updated' | 'session_cleared' | 'file_added' | 'file_removed' | 'file_state_changed';
  sessionId: string;
  data?: any;
  timestamp: Date;
}

export interface FileSessionEvent {
  type: 'file_added' | 'file_removed' | 'file_state_changed';
  filePath: string;
  sessionId: string;
  previousState?: FileState;
  newState?: FileState;
  timestamp: Date;
}
