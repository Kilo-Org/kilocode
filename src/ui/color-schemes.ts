/**
 * Color Schemes for Diff Visualization
 * 
 * Provides predefined color schemes for different diff types and themes
 */

export interface ColorScheme {
  name: string;
  addition: {
    backgroundColor: string;
    borderColor: string;
    textColor: string;
    icon: string;
  };
  deletion: {
    backgroundColor: string;
    borderColor: string;
    textColor: string;
    icon: string;
  };
  modification: {
    backgroundColor: string;
    borderColor: string;
    textColor: string;
    icon: string;
  };
}

/**
 * Color scheme manager for diff visualization
 */
export class ColorSchemes {
  /**
   * VSCode theme colors (adapts to user's VSCode theme)
   */
  static readonly VSCODE: ColorScheme = {
    name: 'vscode',
    addition: {
      backgroundColor: 'rgba(0, 255, 0, 0.1)',
      borderColor: 'rgba(0, 255, 0, 0.3)',
      textColor: '#00ff00',
      icon: '+'
    },
    deletion: {
      backgroundColor: 'rgba(255, 0, 0, 0.1)',
      borderColor: 'rgba(255, 0, 0, 0.3)',
      textColor: '#ff0000',
      icon: '-'
    },
    modification: {
      backgroundColor: 'rgba(255, 255, 0, 0.1)',
      borderColor: 'rgba(255, 255, 0, 0.3)',
      textColor: '#ffff00',
      icon: '~'
    }
  };

  /**
   * High contrast colors for accessibility
   */
  static readonly HIGH_CONTRAST: ColorScheme = {
    name: 'high-contrast',
    addition: {
      backgroundColor: 'rgba(0, 128, 0, 0.2)',
      borderColor: 'rgba(0, 255, 0, 1)',
      textColor: '#00ff80',
      icon: '+'
    },
    deletion: {
      backgroundColor: 'rgba(128, 0, 0, 0.2)',
      borderColor: 'rgba(255, 0, 0, 1)',
      textColor: '#ff0080',
      icon: '-'
    },
    modification: {
      backgroundColor: 'rgba(128, 128, 0, 0.2)',
      borderColor: 'rgba(255, 255, 0, 1)',
      textColor: '#ffff80',
      icon: '~'
    }
  };

  /**
   * Custom green theme
   */
  static readonly CUSTOM_GREEN: ColorScheme = {
    name: 'custom-green',
    addition: {
      backgroundColor: 'rgba(46, 125, 50, 0.15)',
      borderColor: 'rgba(46, 125, 50, 0.8)',
      textColor: '#2e7d32',
      icon: '+'
    },
    deletion: {
      backgroundColor: 'rgba(220, 38, 127, 0.15)',
      borderColor: 'rgba(220, 38, 127, 0.8)',
      textColor: '#dc267f',
      icon: '-'
    },
    modification: {
      backgroundColor: 'rgba(251, 146, 60, 0.15)',
      borderColor: 'rgba(251, 146, 60, 0.8)',
      textColor: '#fb923c',
      icon: '~'
    }
  };

  /**
   * Custom blue theme
   */
  static readonly CUSTOM_BLUE: ColorScheme = {
    name: 'custom-blue',
    addition: {
      backgroundColor: 'rgba(59, 130, 246, 0.15)',
      borderColor: 'rgba(59, 130, 246, 0.8)',
      textColor: '#3b82f6',
      icon: '+'
    },
    deletion: {
      backgroundColor: 'rgba(239, 68, 68, 0.15)',
      borderColor: 'rgba(239, 68, 68, 0.8)',
      textColor: '#ef4444',
      icon: '-'
    },
    modification: {
      backgroundColor: 'rgba(246, 224, 181, 0.15)',
      borderColor: 'rgba(246, 224, 181, 0.8)',
      textColor: '#f6e05c',
      icon: '~'
    }
  };

  /**
   * Get all available color schemes
   */
  static getAllSchemes(): ColorScheme[] {
    return [
      ColorSchemes.VSCODE,
      ColorSchemes.HIGH_CONTRAST,
      ColorSchemes.CUSTOM_GREEN,
      ColorSchemes.CUSTOM_BLUE
    ];
  }

  /**
   * Get color scheme by name
   */
  static getScheme(name: string): ColorScheme | undefined {
    switch (name) {
      case 'vscode':
        return ColorSchemes.VSCODE;
      case 'high-contrast':
        return ColorSchemes.HIGH_CONTRAST;
      case 'custom-green':
        return ColorSchemes.CUSTOM_GREEN;
      case 'custom-blue':
        return ColorSchemes.CUSTOM_BLUE;
      default:
        return undefined;
    }
  }

  /**
   * Get color scheme suitable for current VSCode theme
   */
  static getVSCodeScheme(): ColorScheme {
    // This would ideally detect the current VSCode theme
    // For now, return the default VSCode scheme
    return ColorSchemes.VSCODE;
  }

  /**
   * Get colors for specific diff type from scheme
   */
  static getColorsForType(
    scheme: ColorScheme,
    type: 'addition' | 'deletion' | 'modification'
  ): ColorScheme['addition' | 'deletion' | 'modification'] {
    return scheme[type];
  }

  /**
   * Convert color to CSS rgba string with opacity
   */
  static toRgba(color: string, opacity: number): string {
    if (color.startsWith('#')) {
      const hex = color.slice(1);
      const num = parseInt(hex, 16);
      const r = (num >> 16) & 255;
      const g = (num >> 8) & 255;
      const b = num & 255;
      
      return `rgba(${r}, ${g}, ${b}, ${opacity})`;
    }
    
    return color; // Return original if not hex
  }

  /**
   * Adjust color brightness
   */
  static adjustBrightness(color: string, factor: number): string {
    if (color.startsWith('#')) {
      const hex = color.slice(1);
      const num = parseInt(hex, 16);
      const r = (num >> 16) & 255;
      const g = (num >> 8) & 255;
      const b = num & 255;
      
      const adjustComponent = (value: number) => {
        const adjusted = Math.round(value + (255 - value) * factor);
        return Math.max(0, Math.min(255, adjusted));
      };
      
      const newR = adjustComponent(r);
      const newG = adjustComponent(g);
      const newB = adjustComponent(b);
      
      return `#${((newR << 16) | (newG << 8) | newB).toString(16).padStart(6, '0')}`;
    }
    
    return color; // Return original for non-hex colors
  }

  /**
   * Generate CSS for diff styling
   */
  static generateCSS(scheme: ColorScheme): string {
    return `
/* Diff System Color Scheme: ${scheme.name} */

.diff-addition {
  background-color: ${scheme.addition.backgroundColor};
  border: 1px solid ${scheme.addition.borderColor};
  color: ${scheme.addition.textColor};
}

.diff-deletion {
  background-color: ${scheme.deletion.backgroundColor};
  border: 1px solid ${scheme.deletion.borderColor};
  color: ${scheme.deletion.textColor};
  text-decoration: line-through;
}

.diff-modification {
  background-color: ${scheme.modification.backgroundColor};
  border: 1px solid ${scheme.modification.borderColor};
  color: ${scheme.modification.textColor};
}

.diff-icon-addition::before {
  content: '${scheme.addition.icon}';
  font-weight: bold;
  margin-right: 4px;
}

.diff-icon-deletion::before {
  content: '${scheme.deletion.icon}';
  font-weight: bold;
  margin-right: 4px;
}

.diff-icon-modification::before {
  content: '${scheme.modification.icon}';
  font-weight: bold;
  margin-right: 4px;
}

.diff-accepted {
  opacity: 0.8;
  border-width: 2px;
}

.diff-rejected {
  opacity: 0.4;
}
    `.trim();
  }

  /**
   * Validate color scheme
   */
  static validateScheme(scheme: ColorScheme): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    if (!scheme.name || scheme.name.trim() === '') {
      errors.push('Scheme name is required');
    }
    
    const requiredFields = ['addition', 'deletion', 'modification'] as const;
    for (const field of requiredFields) {
      const typeColors = scheme[field];
      if (!typeColors.backgroundColor || !typeColors.borderColor || !typeColors.textColor || !typeColors.icon) {
        errors.push(`${field} colors are incomplete`);
      }
    }
    
    return {
      isValid: errors.length === 0,
      errors
    };
  }
}
