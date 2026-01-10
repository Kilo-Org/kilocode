/**
 * Validation and Error Handling for Diff Operations
 * 
 * Provides validation utilities and error handling for diff system operations
 */

import { FileBuffer, ShadowBuffer, DiffOverlay } from '../../types/diff-types';
import { Logger, DiffSystemError } from '../error-handler';

/**
 * Validation utilities for diff operations
 */
export class DiffValidator {
  /**
   * Validate file buffer
   */
  static validateFileBuffer(buffer: FileBuffer): { isValid: boolean; errors: string[] } {
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
    
    if (buffer.language && buffer.language.trim() === '') {
      errors.push('Language cannot be empty');
    }
    
    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Validate shadow buffer
   */
  static validateShadowBuffer(buffer: ShadowBuffer): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    if (!buffer.id || buffer.id.trim() === '') {
      errors.push('Shadow buffer ID is required');
    }
    
    if (!buffer.fileBufferId || buffer.fileBufferId.trim() === '') {
      errors.push('File buffer ID is required');
    }
    
    if (buffer.originalContent === undefined) {
      errors.push('Original content is required');
    }
    
    if (buffer.modifiedContent === undefined) {
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

  /**
   * Validate diff overlay
   */
  static validateDiffOverlay(overlay: DiffOverlay): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    if (!overlay.id || overlay.id.trim() === '') {
      errors.push('Overlay ID is required');
    }
    
    if (!overlay.shadowBufferId || overlay.shadowBufferId.trim() === '') {
      errors.push('Shadow buffer ID is required');
    }
    
    if (overlay.startLine < 0 || overlay.endLine < overlay.startLine) {
      errors.push('End line must be greater than or equal to start line');
    }
    
    if (overlay.startLine === overlay.endLine && overlay.type !== 'modification') {
      errors.push('Single line overlays must be of type modification');
    }
    
    const validTypes = ['addition', 'deletion', 'modification'];
    if (!validTypes.includes(overlay.type)) {
      errors.push('Invalid overlay type');
    }
    
    if (overlay.isAccepted && overlay.isRejected) {
      errors.push('Overlay cannot be both accepted and rejected');
    }
    
    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Validate diff result
   */
  static validateDiffResult(result: { additions: any[]; deletions: any[]; modifications: any[] }): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    if (!result.additions || !Array.isArray(result.additions)) {
      errors.push('Additions must be an array');
    }
    
    if (!result.deletions || !Array.isArray(result.deletions)) {
      errors.push('Deletions must be an array');
    }
    
    if (!result.modifications || !Array.isArray(result.modifications)) {
      errors.push('Modifications must be an array');
    }
    
    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Validate file path
   */
  static validateFilePath(filePath: string): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    if (!filePath || filePath.trim() === '') {
      errors.push('File path is required');
    }
    
    // Check for invalid characters
    const invalidChars = /[<>:"|?*]/;
    if (invalidChars.test(filePath)) {
      errors.push('File path contains invalid characters');
    }
    
    // Check for reasonable length
    if (filePath.length > 260) {
      errors.push('File path too long (max 260 characters)');
    }
    
    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Validate content size
   */
  static validateContentSize(content: string, maxSize: number = 10485760): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    if (content.length > maxSize) {
      errors.push(`Content too large (max ${maxSize} bytes)`);
    }
    
    return {
      isValid: errors.length === 0,
      errors
    };
  }
}

/**
 * Error handling utilities for diff operations
 */
export class DiffErrorHandler {
  /**
   * Handle diff creation error
   */
  static handleDiffCreationError(
    operation: string,
    error: unknown,
    context?: any
  ): DiffSystemError {
    const message = `Failed to ${operation}: ${error instanceof Error ? error.message : String(error)}`;
    return Logger.createError('DIFF_CREATION_ERROR', 'DiffValidator', message, context);
  }

  /**
   * Handle overlay rendering error
   */
  static handleOverlayRenderingError(
    operation: string,
    error: unknown,
    context?: any
  ): DiffSystemError {
    const message = `Failed to ${operation}: ${error instanceof Error ? error.message : String(error)}`;
    return Logger.createError('OVERLAY_RENDERING_ERROR', 'DiffRenderer', message, context);
  }

  /**
   * Handle file operation error
   */
  static handleFileOperationError(
    operation: string,
    error: unknown,
    context?: any
  ): DiffSystemError {
    const message = `Failed to ${operation}: ${error instanceof Error ? error.message : String(error)}`;
    return Logger.createError('FILE_OPERATION_ERROR', 'VSCodeIntegration', message, context);
  }

  /**
   * Handle validation error
   */
  static handleValidationError(
    operation: string,
    errors: string[],
    context?: any
  ): DiffSystemError {
    const message = `Validation failed for ${operation}: ${errors.join(', ')}`;
    return Logger.createError('VALIDATION_ERROR', 'DiffValidator', message, context);
  }

  /**
   * Wrap operation with error handling
   */
  static async wrapOperation<T>(
    operation: () => Promise<T>,
    operationName: string,
    context?: any
  ): Promise<{ success: boolean; result?: T; error?: DiffSystemError }> {
    try {
      const result = await operation();
      return { success: true, result };
    } catch (error) {
      const diffError = this.handleDiffCreationError(operationName, error, context);
      return { success: false, error: diffError };
    }
  }

  /**
   * Get user-friendly error message
   */
  static getUserFriendlyMessage(error: DiffSystemError): string {
    switch (error.code) {
      case 'DIFF_CREATION_ERROR':
        return 'Failed to create diff. Please check the file contents and try again.';
      case 'OVERLAY_RENDERING_ERROR':
        return 'Failed to render diff overlay. Please refresh the editor and try again.';
      case 'FILE_OPERATION_ERROR':
        return 'File operation failed. Please check file permissions and try again.';
      case 'VALIDATION_ERROR':
        return 'Invalid input. Please check your inputs and try again.';
      default:
        return error.message || 'An unknown error occurred. Please try again.';
    }
  }
}
