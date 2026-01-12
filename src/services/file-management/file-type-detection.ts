/**
 * File Type Detection and Syntax Highlighting Service
 * 
 * Detects file types and provides syntax highlighting support for diff visualization
 */

import * as vscode from 'vscode';
import { Logger } from '../error-handler';

export interface FileTypeDetection {
  language: string;
  fileExtension: string;
  mimeType: string;
  syntaxHighlighting: boolean;
  supportedFeatures: string[];
}

export interface SyntaxHighlightingRule {
  pattern: RegExp;
  language: string;
  priority: number;
}

/**
 * File type detection and syntax highlighting service
 */
export class FileTypeDetectionService {
  private static readonly LANGUAGE_MAP: Map<string, FileTypeDetection> = new Map([
    // JavaScript/TypeScript
    ['.js', {
      language: 'javascript',
      fileExtension: '.js',
      mimeType: 'application/javascript',
      syntaxHighlighting: true,
      supportedFeatures: ['diff', 'syntax', 'intellisense']
    }],
    ['.ts', {
      language: 'typescript',
      fileExtension: '.ts',
      mimeType: 'application/typescript',
      syntaxHighlighting: true,
      supportedFeatures: ['diff', 'syntax', 'intellisense', 'type-checking']
    }],
    ['.jsx', {
      language: 'javascriptreact',
      fileExtension: '.jsx',
      mimeType: 'application/javascript',
      syntaxHighlighting: true,
      supportedFeatures: ['diff', 'syntax', 'intellisense', 'jsx']
    }],
    ['.tsx', {
      language: 'typescriptreact',
      fileExtension: '.tsx',
      mimeType: 'application/typescript',
      syntaxHighlighting: true,
      supportedFeatures: ['diff', 'syntax', 'intellisense', 'type-checking', 'jsx']
    }],
    
    // Python
    ['.py', {
      language: 'python',
      fileExtension: '.py',
      mimeType: 'text/x-python',
      syntaxHighlighting: true,
      supportedFeatures: ['diff', 'syntax', 'intellisense', 'formatting']
    }],
    
    // Java
    ['.java', {
      language: 'java',
      fileExtension: '.java',
      mimeType: 'text/x-java-source',
      syntaxHighlighting: true,
      supportedFeatures: ['diff', 'syntax', 'intellisense', 'compilation']
    }],
    
    // C/C++
    ['.c', {
      language: 'c',
      fileExtension: '.c',
      mimeType: 'text/x-csrc',
      syntaxHighlighting: true,
      supportedFeatures: ['diff', 'syntax', 'compilation']
    }],
    ['.cpp', {
      language: 'cpp',
      fileExtension: '.cpp',
      mimeType: 'text/x-c++src',
      syntaxHighlighting: true,
      supportedFeatures: ['diff', 'syntax', 'intellisense', 'compilation']
    }],
    ['.h', {
      language: 'c',
      fileExtension: '.h',
      mimeType: 'text/x-chdr',
      syntaxHighlighting: true,
      supportedFeatures: ['diff', 'syntax']
    }],
    ['.hpp', {
      language: 'cpp',
      fileExtension: '.hpp',
      mimeType: 'text/x-c++hdr',
      syntaxHighlighting: true,
      supportedFeatures: ['diff', 'syntax']
    }],
    
    // C#
    ['.cs', {
      language: 'csharp',
      fileExtension: '.cs',
      mimeType: 'text/x-csharp',
      syntaxHighlighting: true,
      supportedFeatures: ['diff', 'syntax', 'intellisense', 'compilation']
    }],
    
    // Go
    ['.go', {
      language: 'go',
      fileExtension: '.go',
      mimeType: 'text/x-go',
      syntaxHighlighting: true,
      supportedFeatures: ['diff', 'syntax', 'intellisense', 'compilation']
    }],
    
    // Rust
    ['.rs', {
      language: 'rust',
      fileExtension: '.rs',
      mimeType: 'text/x-rust',
      syntaxHighlighting: true,
      supportedFeatures: ['diff', 'syntax', 'intellisense', 'compilation']
    }],
    
    // PHP
    ['.php', {
      language: 'php',
      fileExtension: '.php',
      mimeType: 'application/x-httpd-php',
      syntaxHighlighting: true,
      supportedFeatures: ['diff', 'syntax', 'intellisense']
    }],
    
    // Ruby
    ['.rb', {
      language: 'ruby',
      fileExtension: '.rb',
      mimeType: 'text/x-ruby',
      syntaxHighlighting: true,
      supportedFeatures: ['diff', 'syntax', 'intellisense']
    }],
    
    // Web
    ['.html', {
      language: 'html',
      fileExtension: '.html',
      mimeType: 'text/html',
      syntaxHighlighting: true,
      supportedFeatures: ['diff', 'syntax', 'formatting']
    }],
    ['.css', {
      language: 'css',
      fileExtension: '.css',
      mimeType: 'text/css',
      syntaxHighlighting: true,
      supportedFeatures: ['diff', 'syntax', 'formatting']
    }],
    ['.scss', {
      language: 'scss',
      fileExtension: '.scss',
      mimeType: 'text/x-scss',
      syntaxHighlighting: true,
      supportedFeatures: ['diff', 'syntax', 'formatting']
    }],
    ['.sass', {
      language: 'sass',
      fileExtension: '.sass',
      mimeType: 'text/x-sass',
      syntaxHighlighting: true,
      supportedFeatures: ['diff', 'syntax', 'formatting']
    }],
    ['.less', {
      language: 'less',
      fileExtension: '.less',
      mimeType: 'text/x-less',
      syntaxHighlighting: true,
      supportedFeatures: ['diff', 'syntax', 'formatting']
    }],
    
    // Configuration files
    ['.json', {
      language: 'json',
      fileExtension: '.json',
      mimeType: 'application/json',
      syntaxHighlighting: true,
      supportedFeatures: ['diff', 'syntax', 'validation']
    }],
    ['.yaml', {
      language: 'yaml',
      fileExtension: '.yaml',
      mimeType: 'application/x-yaml',
      syntaxHighlighting: true,
      supportedFeatures: ['diff', 'syntax', 'validation']
    }],
    ['.yml', {
      language: 'yaml',
      fileExtension: '.yml',
      mimeType: 'application/x-yaml',
      syntaxHighlighting: true,
      supportedFeatures: ['diff', 'syntax', 'validation']
    }],
    ['.xml', {
      language: 'xml',
      fileExtension: '.xml',
      mimeType: 'application/xml',
      syntaxHighlighting: true,
      supportedFeatures: ['diff', 'syntax', 'validation']
    }],
    ['.toml', {
      language: 'toml',
      fileExtension: '.toml',
      mimeType: 'application/toml',
      syntaxHighlighting: true,
      supportedFeatures: ['diff', 'syntax', 'validation']
    }],
    
    // Documentation
    ['.md', {
      language: 'markdown',
      fileExtension: '.md',
      mimeType: 'text/markdown',
      syntaxHighlighting: true,
      supportedFeatures: ['diff', 'syntax', 'preview']
    }],
    ['.txt', {
      language: 'plaintext',
      fileExtension: '.txt',
      mimeType: 'text/plain',
      syntaxHighlighting: false,
      supportedFeatures: ['diff']
    }],
    
    // Shell scripts
    ['.sh', {
      language: 'shellscript',
      fileExtension: '.sh',
      mimeType: 'application/x-sh',
      syntaxHighlighting: true,
      supportedFeatures: ['diff', 'syntax']
    }],
    ['.bash', {
      language: 'shellscript',
      fileExtension: '.bash',
      mimeType: 'application/x-sh',
      syntaxHighlighting: true,
      supportedFeatures: ['diff', 'syntax']
    }],
    ['.zsh', {
      language: 'shellscript',
      fileExtension: '.zsh',
      mimeType: 'application/x-sh',
      syntaxHighlighting: true,
      supportedFeatures: ['diff', 'syntax']
    }],
    
    // SQL
    ['.sql', {
      language: 'sql',
      fileExtension: '.sql',
      mimeType: 'application/sql',
      syntaxHighlighting: true,
      supportedFeatures: ['diff', 'syntax', 'formatting']
    }],
    
    // Docker
    ['Dockerfile', {
      language: 'dockerfile',
      fileExtension: 'Dockerfile',
      mimeType: 'text/x-dockerfile',
      syntaxHighlighting: true,
      supportedFeatures: ['diff', 'syntax']
    }],
    
    // Git
    ['.gitignore', {
      language: 'gitignore',
      fileExtension: '.gitignore',
      mimeType: 'text/plain',
      syntaxHighlighting: true,
      supportedFeatures: ['diff', 'syntax']
    }],
    
    // Configuration files without extensions
    ['.env', {
      language: 'dotenv',
      fileExtension: '.env',
      mimeType: 'application/x-env',
      syntaxHighlighting: true,
      supportedFeatures: ['diff', 'syntax']
    }]
  ]);

  private static readonly CONTENT_BASED_RULES: SyntaxHighlightingRule[] = [
    // Shebang patterns
    { pattern: /^#!.*\/bin\/bash/, language: 'shellscript', priority: 100 },
    { pattern: /^#!.*\/bin\/sh/, language: 'shellscript', priority: 100 },
    { pattern: /^#!.*\/bin\/zsh/, language: 'shellscript', priority: 100 },
    { pattern: /^#!.*\/bin\/python/, language: 'python', priority: 100 },
    { pattern: /^#!.*\/bin\/node/, language: 'javascript', priority: 100 },
    
    // File content patterns
    { pattern: /^\s*<[^>]+>/, language: 'html', priority: 80 }, // HTML tags
    { pattern: /^\s*{[^}]*}/, language: 'json', priority: 80 }, // JSON object
    { pattern: /^\s*import\s+/, language: 'python', priority: 70 }, // Python import
    { pattern: /^\s*package\s+/, language: 'java', priority: 70 }, // Java package
    { pattern: /^\s*using\s+/, language: 'csharp', priority: 70 }, // C# using
    { pattern: /^\s*package\s+main/, language: 'go', priority: 70 }, // Go package main
    { pattern: /^\s*fn\s+/, language: 'rust', priority: 70 }, // Rust function
    { pattern: /^\s*func\s+/, language: 'go', priority: 70 }, // Go function
  ];

  /**
   * Detect file type by file path
   */
  static detectFileType(filePath: string): FileTypeDetection | null {
    try {
      // Extract file extension
      const extension = this.getFileExtension(filePath);
      
      // Check language map
      const detection = this.LANGUAGE_MAP.get(extension);
      if (detection) {
        return detection;
      }

      // Check special files without extensions
      const fileName = this.getFileName(filePath);
      const specialDetection = this.LANGUAGE_MAP.get(fileName);
      if (specialDetection) {
        return specialDetection;
      }

      // Default to plaintext
      return {
        language: 'plaintext',
        fileExtension: extension,
        mimeType: 'text/plain',
        syntaxHighlighting: false,
        supportedFeatures: ['diff']
      };
    } catch (error) {
      Logger.error('FileTypeDetectionService.detectFileType', `Failed to detect file type for: ${filePath}`, error);
      return null;
    }
  }

  /**
   * Detect file type by content
   */
  static async detectFileTypeByContent(filePath: string, content: string): Promise<FileTypeDetection | null> {
    try {
      // First try extension-based detection
      const extensionDetection = this.detectFileType(filePath);
      if (extensionDetection && extensionDetection.language !== 'plaintext') {
        return extensionDetection;
      }

      // Fall back to content-based detection
      for (const rule of this.CONTENT_BASED_RULES) {
        if (rule.pattern.test(content)) {
          const detection = this.LANGUAGE_MAP.get(`.${rule.language}`);
          if (detection) {
            return detection;
          }
        }
      }

      // Default to plaintext
      return {
        language: 'plaintext',
        fileExtension: this.getFileExtension(filePath),
        mimeType: 'text/plain',
        syntaxHighlighting: false,
        supportedFeatures: ['diff']
      };
    } catch (error) {
      Logger.error('FileTypeDetectionService.detectFileTypeByContent', `Failed to detect file type by content for: ${filePath}`, error);
      return null;
    }
  }

  /**
   * Get VSCode language ID for file
   */
  static getVSCodeLanguageId(filePath: string): string {
    const detection = this.detectFileType(filePath);
    return detection?.language || 'plaintext';
  }

  /**
   * Check if file supports syntax highlighting
   */
  static supportsSyntaxHighlighting(filePath: string): boolean {
    const detection = this.detectFileType(filePath);
    return detection?.syntaxHighlighting || false;
  }

  /**
   * Check if file supports specific feature
   */
  static supportsFeature(filePath: string, feature: string): boolean {
    const detection = this.detectFileType(filePath);
    return detection?.supportedFeatures.includes(feature) || false;
  }

  /**
   * Get syntax highlighting theme for file type
   */
  static getSyntaxHighlightingTheme(filePath: string): string {
    const detection = this.detectFileType(filePath);
    
    // Return appropriate theme based on language
    switch (detection?.language) {
      case 'javascript':
      case 'typescript':
      case 'javascriptreact':
      case 'typescriptreact':
        return 'vscode-typescript';
      case 'python':
        return 'vscode-python';
      case 'java':
        return 'vscode-java';
      case 'cpp':
      case 'c':
        return 'vscode-cpp';
      case 'csharp':
        return 'vscode-csharp';
      case 'go':
        return 'vscode-go';
      case 'rust':
        return 'vscode-rust';
      case 'html':
        return 'vscode-html';
      case 'css':
      case 'scss':
      case 'sass':
      case 'less':
        return 'vscode-css';
      case 'json':
        return 'vscode-json';
      case 'yaml':
        return 'vscode-yaml';
      case 'markdown':
        return 'vscode-markdown';
      default:
        return 'vscode-default';
    }
  }

  /**
   * Get supported file extensions
   */
  static getSupportedExtensions(): string[] {
    return Array.from(this.LANGUAGE_MAP.keys());
  }

  /**
   * Get file statistics for a workspace
   */
  static async getWorkspaceFileStats(workspaceRoot: string): Promise<{
    totalFiles: number;
    filesByLanguage: Map<string, number>;
    filesWithSyntaxHighlighting: number;
  }> {
    try {
      const files = await vscode.workspace.findFiles('**/*', '**/node_modules/**');
      const filesByLanguage = new Map<string, number>();
      let filesWithSyntaxHighlighting = 0;

      for (const file of files) {
        const detection = this.detectFileType(file.fsPath);
        if (detection) {
          const count = filesByLanguage.get(detection.language) || 0;
          filesByLanguage.set(detection.language, count + 1);
          
          if (detection.syntaxHighlighting) {
            filesWithSyntaxHighlighting++;
          }
        }
      }

      return {
        totalFiles: files.length,
        filesByLanguage,
        filesWithSyntaxHighlighting
      };
    } catch (error) {
      Logger.error('FileTypeDetectionService.getWorkspaceFileStats', 'Failed to get workspace file stats', error);
      return {
        totalFiles: 0,
        filesByLanguage: new Map(),
        filesWithSyntaxHighlighting: 0
      };
    }
  }

  /**
   * Extract file extension from path
   */
  private static getFileExtension(filePath: string): string {
    const lastDot = filePath.lastIndexOf('.');
    if (lastDot === -1) {
      return '';
    }
    return filePath.substring(lastDot);
  }

  /**
   * Extract file name from path
   */
  private static getFileName(filePath: string): string {
    const lastSlash = filePath.lastIndexOf('/');
    const fileName = lastSlash === -1 ? filePath : filePath.substring(lastSlash + 1);
    return fileName;
  }
}
