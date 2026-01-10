/**
 * Diff Overlay Entity
 * 
 * Visual representation of changes overlaid on the main editor
 */

import { DiffOverlay } from '../types/diff-types';

export class DiffOverlayEntity {
  /**
   * Create new diff overlay
   */
  static create(
    id: string,
    shadowBufferId: string,
    startLine: number,
    endLine: number,
    type: 'addition' | 'deletion' | 'modification',
    content: string
  ): DiffOverlay {
    return {
      id,
      shadowBufferId,
      startLine,
      endLine,
      type,
      content,
      isAccepted: false,
      isRejected: false
    };
  }

  /**
   * Mark overlay as accepted
   */
  static markAccepted(overlay: DiffOverlay): DiffOverlay {
    return {
      ...overlay,
      isAccepted: true,
      isRejected: false
    };
  }

  /**
   * Mark overlay as rejected
   */
  static markRejected(overlay: DiffOverlay): DiffOverlay {
    return {
      ...overlay,
      isAccepted: false,
      isRejected: true
    };
  }

  /**
   * Validate diff overlay
   */
  static validate(overlay: DiffOverlay): { isValid: boolean; errors: string[] } {
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
    
    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Get overlay length in lines
   */
  static getLength(overlay: DiffOverlay): number {
    return overlay.endLine - overlay.startLine + 1;
  }

  /**
   * Check if overlay affects a specific line
   */
  static affectsLine(overlay: DiffOverlay, lineNumber: number): boolean {
    return lineNumber >= overlay.startLine && lineNumber <= overlay.endLine;
  }
}
