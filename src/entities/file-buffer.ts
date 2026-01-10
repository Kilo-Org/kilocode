/**
 * File Buffer Entity
 * 
 * Represents the main editor content buffer for each open file
 */

import { FileBuffer } from '../types/diff-types';

export class FileBufferEntity {
  /**
   * Create new file buffer
   */
  static create(
    id: string,
    filePath: string,
    content: string,
    language: string,
    version: number = 1
  ): FileBuffer {
    return {
      id,
      filePath,
      content,
      version,
      language,
      isOpen: false,
      lastModified: new Date()
    };
  }

  /**
   * Update file buffer content
   */
  static updateContent(buffer: FileBuffer, newContent: string): FileBuffer {
    return {
      ...buffer,
      content: newContent,
      version: buffer.version + 1,
      lastModified: new Date()
    };
  }

  /**
   * Mark buffer as open
   */
  static markOpen(buffer: FileBuffer): FileBuffer {
    return {
      ...buffer,
      isOpen: true
    };
  }

  /**
   * Mark buffer as closed
   */
  static markClosed(buffer: FileBuffer): FileBuffer {
    return {
      ...buffer,
      isOpen: false
    };
  }

  /**
   * Validate file buffer
   */
  static validate(buffer: FileBuffer): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    if (!buffer.id || buffer.id.trim() === '') {
      errors.push('File buffer ID is required');
    }
    
    if (!buffer.filePath || buffer.filePath.trim() === '') {
      errors.push('File path is required');
    }
    
    if (buffer.version < 0) {
      errors.push('Version must be non-negative');
    }
    
    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Get file language from path
   */
  static detectLanguage(filePath: string): string {
    const extension = filePath.split('.').pop()?.toLowerCase();
    
    switch (extension) {
      case 'js':
      case 'jsx':
      case 'ts':
      case 'tsx':
        return 'javascript';
      case 'py':
        return 'python';
      case 'xml':
        return 'xml';
      case 'java':
        return 'java';
      case 'cs':
        return 'csharp';
      case 'cpp':
      case 'c':
      case 'h':
        return 'cpp';
      default:
        return 'plaintext';
    }
  }
}
