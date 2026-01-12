# Data Model: Multi-File Diff and Auto-Navigation System

**Date**: January 10, 2026  
**Purpose**: Define core entities and their relationships for the diff system

## Core Entities

### FileBuffer

Represents the main editor content buffer for each open file.

**Fields**:
- `id`: string - Unique identifier for the buffer
- `filePath`: string - Absolute path to the file
- `content`: string - Current file content
- `version`: number - Monotonically increasing version
- `language`: string - File language (python, xml, javascript, etc.)
- `isOpen`: boolean - Whether file is currently open in editor
- `lastModified`: Date - Last modification timestamp

**Validation Rules**:
- `filePath` must be valid absolute path
- `version` must be non-negative integer
- `language` must be supported file type

### ShadowBuffer

Temporary buffer containing proposed changes for diff visualization.

**Fields**:
- `id`: string - Unique identifier
- `fileBufferId`: string - Reference to parent FileBuffer
- `originalContent`: string - Content before changes
- `modifiedContent`: string - Content after changes
- `diffFormat`: 'unified' | 'partial' | 'custom'
- `createdAt`: Date - When shadow buffer was created
- `status`: 'pending' | 'accepted' | 'rejected'

**Validation Rules**:
- `fileBufferId` must reference existing FileBuffer
- `diffFormat` must be supported format
- `status` must be valid state

### DiffOverlay

Visual representation of changes overlaid on the main editor.

**Fields**:
- `id`: string - Unique identifier
- `shadowBufferId`: string - Reference to parent ShadowBuffer
- `startLine`: number - Starting line number (0-indexed)
- `endLine`: number - Ending line number (0-indexed)
- `type`: 'addition' | 'deletion' | 'modification'
- `content`: string - Diff content
- `isAccepted`: boolean - Whether change has been accepted
- `isRejected`: boolean - Whether change has been rejected

**Validation Rules**:
- `startLine` must be <= `endLine`
- `type` must be valid diff type
- Cannot be both accepted and rejected

### SessionState

Persistent state tracking all AI-driven modifications across files.

**Fields**:
- `id`: string - Unique session identifier
- `activeShadowBuffers`: string[] - Array of shadow buffer IDs
- `fileStates`: Map<string, FileState> - Per-file state tracking
- `globalSettings`: SessionSettings - User preferences
- `createdAt`: Date - Session creation timestamp
- `lastActivity`: Date - Last activity timestamp

**Validation Rules**:
- `activeShadowBuffers` must reference existing ShadowBuffer instances
- `fileStates` keys must be valid file paths

### FileState

Per-file state within a session.

**Fields**:
- `filePath`: string - File path
- `hasUnsavedChanges`: boolean - Whether file has unsaved modifications
- `activeDiffCount`: number - Number of active diffs
- `lastSyncVersion`: number - Last synchronized version

**Validation Rules**:
- `activeDiffCount` must be non-negative
- `lastSyncVersion` must be valid version number

## State Transitions

### ShadowBuffer Lifecycle

```
pending → accepted → merged
pending → rejected → discarded
```

### DiffOverlay Interaction

```
created → displayed → {accepted | rejected} → removed
```

### Session State Management

```
created → active → {saved | discarded} → archived
```

## Relationships

```mermaid
erDiagram
    FileBuffer ||--o{ ShadowBuffer : contains
    ShadowBuffer ||--o{ DiffOverlay : generates
    SessionState ||--o{ ShadowBuffer : manages
    SessionState ||--o{ FileState : tracks
    FileBuffer ||--|| FileState : corresponds to
    
    FileBuffer {
        string id PK
        string filePath
        string content
        number version
        string language
        boolean isOpen
        Date lastModified
    }
    
    ShadowBuffer {
        string id PK
        string fileBufferId FK
        string originalContent
        string modifiedContent
        string diffFormat
        Date createdAt
        string status
    }
    
    DiffOverlay {
        string id PK
        string shadowBufferId FK
        number startLine
        number endLine
        string type
        string content
        boolean isAccepted
        boolean isRejected
    }
    
    SessionState {
        string id PK
        string[] activeShadowBuffers
        Map fileStates
        SessionSettings globalSettings
        Date createdAt
        Date lastActivity
    }
    
    FileState {
        string filePath PK
        boolean hasUnsavedChanges
        number activeDiffCount
        number lastSyncVersion
    }
```

## Data Access Patterns

### Queries

- Get all active shadow buffers for a session
- Get all diff overlays for a shadow buffer
- Get file state by file path
- Get pending changes for a file

### Updates

- Create shadow buffer from AI response
- Update diff overlay acceptance status
- Merge accepted changes into file buffer
- Update session activity timestamp

### Constraints

- One shadow buffer per file per AI response
- Diff overlays must be within file bounds
- Session state must be consistent across all files
- No circular references between entities
