/**
 * Shadow Buffer Entity
 * 
 * Temporary buffer containing proposed changes for diff visualization
 */

import { ShadowBuffer } from '../types/diff-types';

export class ShadowBufferEntity {
  /**
   * Create new shadow buffer
   */
  static create(
    id: string,
    fileBufferId: string,
    originalContent: string,
    modifiedContent: string,
    diffFormat: 'unified' | 'partial' | 'custom' = 'unified'
  ): ShadowBuffer {
    return {
      id,
      fileBufferId,
      originalContent,
      modifiedContent,
      diffFormat,
      createdAt: new Date(),
      status: 'pending'
    };
  }

  /**
   * Mark shadow buffer as accepted
   */
  static markAccepted(buffer: ShadowBuffer): ShadowBuffer {
    return {
      ...buffer,
      status: 'accepted'
    };
  }

  /**
   * Mark shadow buffer as rejected
   */
  static markRejected(buffer: ShadowBuffer): ShadowBuffer {
    return {
      ...buffer,
      status: 'rejected'
    };
  }

  /**
   * Validate shadow buffer
   */
  static validate(buffer: ShadowBuffer): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    if (!buffer.id || buffer.id.trim() === '') {
      errors.push('Shadow buffer ID is required');
    }
    
    if (!buffer.fileBufferId || buffer.fileBufferId.trim() === '') {
      errors.push('File buffer ID is required');
    }
    
    if (!buffer.originalContent && buffer.originalContent !== '') {
      errors.push('Original content is required');
    }
    
    if (!buffer.modifiedContent && buffer.modifiedContent !== '') {
      errors.push('Modified content is required');
    }
    
    const validFormats = ['unified', 'partial', 'custom'];
    if (!validFormats.includes(buffer.diffFormat)) {
      errors.push('Invalid diff format');
    }
    
    return {
      isValid: errors.length === 0,
      errors
    };
  }
}
