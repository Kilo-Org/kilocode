/**
 * Diff System Type Definitions
 * 
 * Core types for the Multi-File Diff and Auto-Navigation System
 */

export interface FileBuffer {
  id: string;
  filePath: string;
  content: string;
  version: number;
  language: string;
  isOpen: boolean;
  lastModified: Date;
}

export interface ShadowBuffer {
  id: string;
  fileBufferId: string;
  originalContent: string;
  modifiedContent: string;
  diffFormat: 'unified' | 'partial' | 'custom';
  createdAt: Date;
  status: 'pending' | 'accepted' | 'rejected';
}

export interface DiffOverlay {
  id: string;
  shadowBufferId: string;
  startLine: number;
  endLine: number;
  type: 'addition' | 'deletion' | 'modification';
  content: string;
  isAccepted: boolean;
  isRejected: boolean;
}

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

export interface DiffResult {
  additions: DiffLine[];
  deletions: DiffLine[];
  modifications: DiffLine[];
}

export interface DiffLine {
  lineNumber: number;
  content: string;
  type: 'addition' | 'deletion' | 'modification';
}

export interface StreamingDiffOptions {
  chunkSize?: number;
  onProgress?: (progress: number) => void;
}

export interface CreateDiffRequest {
  filePath: string;
  diffContent: string;
  diffFormat: 'unified' | 'partial' | 'custom';
  source?: string;
}

export interface CreateDiffResponse {
  success: boolean;
  shadowBufferId?: string;
  diffOverlays?: DiffOverlay[];
  error?: string;
}

export interface DiffActionResponse {
  success: boolean;
  message: string;
  fileBufferUpdated: boolean;
}

export interface OpenFileRequest {
  filePath: string;
  action?: 'open' | 'focus' | 'background';
  createIfNotExists?: boolean;
}

export interface OpenFileResponse {
  success: boolean;
  fileBufferId?: string;
  isNewTab?: boolean;
  error?: string;
}

export interface SessionActionResponse {
  success: boolean;
  message: string;
  clearedBuffers?: number;
}

// Event types
export interface DiffEvent {
  type: 'diff_created' | 'diff_accepted' | 'diff_rejected' | 'session_cleared';
  data: any;
  timestamp: Date;
}

export interface FileChangeEvent {
  type: 'file_opened' | 'file_closed' | 'file_modified';
  filePath: string;
  fileBufferId: string;
  timestamp: Date;
}

// Validation rules
export interface ValidationRule {
  field: string;
  rule: string;
  message: string;
}

// Performance metrics
export interface PerformanceMetrics {
  activeDiffCount: number;
  memoryUsage: number;
  avgResponseTime: number;
  totalProcessedFiles: number;
  averageFileSize: number;
}
