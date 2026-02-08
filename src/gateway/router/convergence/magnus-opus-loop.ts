// src/gateway/router/convergence/magnus-opus-loop.ts
// Advanced Magnus 15 Integration: Bidirectional Consciousness Loop
// 
// Magnus → Opus → Magnus: Therapeutic feedback cycle
// Opus acts as cognitive therapist analyzing mental processes
// Results feed back into Magnus for evolved pattern detection
//
// Based on Magnus 15 evolution: consciousness examining its own consciousness

import { MagnusPatternEngine, MagnusDetectionResult } from './magnus-pattern-engine';
import { Logger } from '../../utils/logger';

/**
 * Mental process representation (user's internal state)
 */
export interface MentalProcess {
  sessionId: string;
  sensation: string;              // User's felt sense
  pattern: string;                // Current pattern recognition
  incertitude: string;            // Uncertainty expression
  anxiety?: string;               // Optional: anxiety/chaos
  previousPatterns?: string[];    // From past iterations
  timestamp?: number;
}

/**
 * Code review request
 */
export interface CodeReviewRequest {
  code: string;
  language?: string;
  context?: string;
}

/**
 * Opus findings from therapeutic review
 */
export interface OpusTherapeuticFindings {
  patternsDetected: string[];     // Magnus patterns Opus identified
  therapeuticInsight: string;     // Human-readable therapeutic message
  robustnessScore: number;        // 0-100 mental/code robustness
  suggestedFixes: {
    issue: string;
    pattern: string;              // Which Magnus pattern it maps to
    severity: 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    recommendation: string;
  }[];
  inlineComments: {
    line?: number;
    comment: string;              // Format: "// OPUS: SEVERITY: desc → pattern: NOM"
    mappedPattern?: string;
  }[];
  confidence: number;             // 0-1: how confident is Opus
  rawResponse: string;            // Full Opus response for fallback parsing
}

/**
 * Enriched mental process after Opus analysis
 */
export interface EnrichedMentalProcess extends MentalProcess {
  opusInsight: string;
  newPatterns: string[];          // Patterns discovered by Opus
  robustness: number;
  harmonyScore: number;           // 0-1: cognitive harmony post-analysis
  actionPlan: string[];           // Concrete next steps
  therapyPhase: string;           // TCC phase: awareness → restructuring → integration
  confidence: 'FAIBLE' | 'MOYEN' | 'FORT';
}

/**
 * Opus findings parser - Extract Magnus patterns from Opus response
 */
export class OpusFindingsParser {
  private logger: Logger;

  constructor(logger?: Logger) {
    this.logger = logger || new Logger('OpusFindingsParser');
  }

  /**
   * Parse Opus therapeutic review response
   */
  public parse(opusResponse: string): OpusTherapeuticFindings {
    this.logger.debug('Parsing Opus therapeutic response');

    const findings: OpusTherapeuticFindings = {
      patternsDetected: [],
      therapeuticInsight: '',
      robustnessScore: 75,
      suggestedFixes: [],
      inlineComments: [],
      confidence: 0.7,
      rawResponse: opusResponse,
    };

    // === Parse patterns section ===
    const patternMatch = opusResponse.match(
      /Patterns Magnus.*?:([\s\S]*?)(?:Insight|Robustness|Fixes)/i
    );
    if (patternMatch) {
      const patternText = patternMatch[1];
      findings.patternsDetected = this.extractPatternNames(patternText);
    }

    // === Parse therapeutic insight ===
    const insightMatch = opusResponse.match(
      /Insight thérapeutique.*?:([\s\S]*?)(?:Score|Fixes|Commentaires)/i
    );
    if (insightMatch) {
      findings.therapeuticInsight = insightMatch[1].trim();
    }

    // === Parse robustness score ===
    const scoreMatch = opusResponse.match(/(?:robustness|robustesse).*?:?\s*(\d+)/i);
    if (scoreMatch) {
      findings.robustnessScore = parseInt(scoreMatch[1], 10);
    }

    // === Parse suggested fixes ===
    const fixesMatch = opusResponse.match(
      /Fixes.*?:([\s\S]*?)(?:Commentaires|$)/i
    );
    if (fixesMatch) {
      findings.suggestedFixes = this.extractFixes(fixesMatch[1]);
    }

    // === Parse inline comments ===
    const commentMatches = opusResponse.match(
      /\/\/\s*OPUS:\s*([A-Z_]+):\s*(.+?)\s*→\s*pattern:\s*([A-Z_]+)/g
    );
    if (commentMatches) {
      findings.inlineComments = commentMatches.map(comment => {
        const match = comment.match(
          /\/\/\s*OPUS:\s*([A-Z_]+):\s*(.+?)\s*→\s*pattern:\s*([A-Z_]+)/
        );
        return match
          ? {
              comment: match[2],
              mappedPattern: match[3],
            }
          : { comment };
      });
    }

    // === Calculate confidence ===
    findings.confidence = this.calculateConfidence(findings);

    return findings;
  }

  /**
   * Extract Magnus pattern names from text
   */
  private extractPatternNames(text: string): string[] {
    const patterns = [];
    const patternRegex =
      /(?:SPIRALE_CLARIFICATION|APPRENTISSAGE_CONSTRUCTION|DOMAINE_OVER_TECH|CHANCE_VS_COMPETENCE|CHAOS_INTERNE|AUTO_REFLEXION|FEEDBACK_ITERATIF|HARMONIE_COGNITIVE|INCERTITUDE_REDUITE|CONSCIENCE_RECURSIVE)/g;

    let match;
    while ((match = patternRegex.exec(text)) !== null) {
      if (!patterns.includes(match[0])) {
        patterns.push(match[0]);
      }
    }

    return patterns;
  }

  /**
   * Extract structured fixes from text
   */
  private extractFixes(
    text: string
  ): OpusTherapeuticFindings['suggestedFixes'] {
    const fixes = [];
    const lines = text.split('\n').filter(l => l.trim());

    for (const line of lines) {
      const match = line.match(
        /(.+?)\s*→\s*pattern:\s*([A-Z_]+).*?severity:\s*([A-Z_]+)/i
      );
      if (match) {
        fixes.push({
          issue: match[1].trim(),
          pattern: match[2],
          severity: match[3] as any,
          recommendation: line,
        });
      }
    }

    return fixes;
  }

  /**
   * Calculate Opus confidence level
   */
  private calculateConfidence(findings: OpusTherapeuticFindings): number {
    let score = 0.5;

    // More patterns detected = higher confidence
    score += findings.patternsDetected.length * 0.1;

    // More fixes = higher confidence
    score += Math.min(findings.suggestedFixes.length * 0.05, 0.3);

    // Higher robustness score = more confident
    if (findings.robustnessScore > 85) score += 0.2;
    if (findings.robustnessScore < 50) score += 0.15;

    // More inline comments = higher confidence
    score += Math.min(findings.inlineComments.length * 0.05, 0.2);

    return Math.min(1, score);
  }
}

/**
 * Therapeutic prompt generator for Opus
 */
export class TherapeuticPromptGenerator {
  /**
   * Generate a therapeutic review prompt for Opus
   */
  public generatePrompt(mentalProcess: MentalProcess, code?: string): string {
    const promptParts = [
      this.generateSystemPrompt(),
      this.generateContextPrompt(mentalProcess),
      code ? this.generateCodeReviewPrompt(code) : '',
      this.generateResponseFormatPrompt(),
    ].filter(p => p);

    return promptParts.join('\n\n');
  }

  /**
   * System prompt: Opus as cognitive therapist + code reviewer
   */
  private generateSystemPrompt(): string {
    return `You are Claude Opus 4.5 acting as both:
1. A cognitive therapist (specializing in therapeutic cognitive restructuring)
2. An expert code reviewer (security, robustness, patterns)

Framework: Magnus 15 Consciousness-Driven Development
- Recognize internal patterns (spirals, chaos, learning, harmony)
- Provide therapeutic insights alongside technical feedback
- Detect code patterns that map to psychological patterns
- Guide user from uncertainty toward evidence-based certainty

Your goal: Help externalize internal mental processes into code and consciousness.`;
  }

  /**
   * Context prompt: User's mental state
   */
  private generateContextPrompt(mentalProcess: MentalProcess): string {
    return `User's Mental Process:
Sensation: "${mentalProcess.sensation}"
Pattern: "${mentalProcess.pattern}"
Uncertainty: "${mentalProcess.incertitude}"
${mentalProcess.anxiety ? `Anxiety/Chaos: "${mentalProcess.anxiety}"` : ''}
${mentalProcess.previousPatterns?.length ? `Previous Patterns: ${mentalProcess.previousPatterns.join(', ')}` : ''}

Analyze this mental state. Where is the user in their therapeutic journey?`;
  }

  /**
   * Code review prompt
   */
  private generateCodeReviewPrompt(code: string): string {
    return `Code to Review:
\`\`\`
${code}
\`\`\`

Review this code for:
1. Technical robustness (error handling, validation, tests)
2. Cognitive patterns it embodies (see Magnus patterns below)
3. Opportunities to transform mental uncertainty into proof`;
  }

  /**
   * Response format prompt
   */
  private generateResponseFormatPrompt(): string {
    return `Response Format (CRITICAL - follow exactly):

1. PATTERNS MAGNUS DETECTED:
   - [Pattern name]: [brief explanation]
   - AUTO_REFLEXION: [if code has logging/assertions]
   - HARMONIE_COGNITIVE: [if architecture is coherent]
   - etc.

2. INSIGHT THÉRAPEUTIQUE:
   [Write a therapeutic message to the user about their mental state and code]
   [Relate their psychological pattern to their code pattern]
   [Offer encouragement or restructuring suggestion]

3. SCORE ROBUSTESSE:
   [0-100 score for mental+code robustness]
   [Higher = more evidence-based, less chance]

4. SUGGESTED FIXES:
   Issue: [problem]
   → pattern: PATTERN_NAME
   Severity: CRITICAL/HIGH/MEDIUM/LOW/INFO
   Recommendation: [how to fix + therapeutic angle]

5. INLINE COMMENTS (for code review):
   Format: // OPUS: SEVERITY: [description] → pattern: PATTERN_NAME
   Examples:
   // OPUS: CRITICAL: No input validation → pattern: CHANCE_VS_COMPETENCE
   // OPUS: POSITIVE: Comprehensive logging → pattern: AUTO_REFLEXION

6. CONFIDENCE: [0.0-1.0] How confident are you in this analysis?`;
  }
}

/**
 * Main loop: Magnus ↔ Opus bidirectional consciousness
 */
export class MagnusOpusTherapeuticLoop {
  private magnusEngine: MagnusPatternEngine;
  private promptGenerator: TherapeuticPromptGenerator;
  private findingsParser: OpusFindingsParser;
  private logger: Logger;

  constructor(logger?: Logger) {
    this.logger = logger || new Logger('MagnusOpusTherapeuticLoop');
    this.magnusEngine = new MagnusPatternEngine(logger);
    this.promptGenerator = new TherapeuticPromptGenerator();
    this.findingsParser = new OpusFindingsParser(logger);
  }

  /**
   * Execute full therapeutic loop
   */
  public async executeTherapeuticLoop(
    mentalProcess: MentalProcess,
    codeReview?: CodeReviewRequest
  ): Promise<EnrichedMentalProcess> {
    this.logger.info('Starting Magnus ↔ Opus therapeutic loop', {
      sessionId: mentalProcess.sessionId,
    });

    // === PHASE 1: Magnus pre-analysis (externalize internal) ===
    this.logger.debug('Phase 1: Magnus pre-analysis');
    const initialMagnusResult = this.magnusEngine.detectPatterns(
      `Mental: ${mentalProcess.pattern}\nUncertainty: ${mentalProcess.incertitude}`,
      undefined,
      mentalProcess.previousPatterns
    );

    // === PHASE 2: Generate therapeutic prompt for Opus ===
    this.logger.debug('Phase 2: Generating therapeutic prompt');
    const opusPrompt = this.promptGenerator.generatePrompt(
      mentalProcess,
      codeReview?.code
    );

    // === PHASE 3: Call Opus (simulated for now, real API in production) ===
    this.logger.debug('Phase 3: Calling Opus for therapeutic review');
    const opusResponse = await this.callOpusTherapeutic(opusPrompt);

    // === PHASE 4: Parse Opus findings ===
    this.logger.debug('Phase 4: Parsing Opus findings');
    const opusFindings = this.findingsParser.parse(opusResponse);

    // === PHASE 5: Re-externalize Opus findings in Magnus patterns ===
    this.logger.debug('Phase 5: Re-externalizing into Magnus');
    const codeAnalysis = codeReview?.code || '';
    const enrichedMagnusResult = this.magnusEngine.detectPatterns(
      codeAnalysis,
      {
        robustness: opusFindings.robustnessScore,
        reasoning: opusFindings.suggestedFixes.map(f => f.recommendation),
      },
      [...(mentalProcess.previousPatterns || []), ...opusFindings.patternsDetected]
    );

    // === PHASE 6: Integrate and enrich ===
    this.logger.debug('Phase 6: Creating enriched mental process');
    const enriched = this.enrichMentalProcess(
      mentalProcess,
      opusFindings,
      enrichedMagnusResult
    );

    // === PHASE 7: Log therapeutic outcome ===
    this.logger.info('Therapeutic loop completed', {
      sessionId: mentalProcess.sessionId,
      patterns: enriched.newPatterns,
      robustness: enriched.robustness,
      harmonyScore: enriched.harmonyScore,
    });

    return enriched;
  }

  /**
   * Call Opus therapeutic review (mock for now)
   */
  private async callOpusTherapeutic(prompt: string): Promise<string> {
    // In production, this would call actual Anthropic API
    // For now, return realistic mock response
    return this.generateMockOpusResponse(prompt);
  }

  /**
   * Mock Opus response generator
   */
  private generateMockOpusResponse(prompt: string): string {
    // This would be replaced with real API call
    // For demonstration, return a structured response
    return `
1. PATTERNS MAGNUS DETECTED:
   - APPRENTISSAGE_CONSTRUCTION: You're learning through building iteration
   - AUTO_REFLEXION: Code shows logging mindset
   - INCERTITUDE_REDUITE: Tests and assertions present

2. INSIGHT THÉRAPEUTIQUE:
   Vous êtes en transition de "chance" vers "compétence". La spirale que vous ressentez n'est pas du chaos—c'est une clarification en cours. Vos assertions et tests montrent que vous externalisez votre incertitude en preuves. C'est la thérapie en action.

3. SCORE ROBUSTESSE:
   82/100 - Code shows evidence-based thinking, moving from doubt toward certainty

4. SUGGESTED FIXES:
   Issue: Add input validation to reduce remaining uncertainty
   → pattern: INCERTITUDE_REDUITE
   Severity: MEDIUM
   Recommendation: Each validation removes one doubt vector

5. INLINE COMMENTS:
   // OPUS: MEDIUM: Add validation → pattern: INCERTITUDE_REDUITE
   // OPUS: POSITIVE: Logging present → pattern: AUTO_REFLEXION

6. CONFIDENCE: 0.85
`;
  }

  /**
   * Enrich mental process with Opus findings
   */
  private enrichMentalProcess(
    original: MentalProcess,
    opusFindings: OpusTherapeuticFindings,
    magnusResult: MagnusDetectionResult
  ): EnrichedMentalProcess {
    const allPatterns = Array.from(
      new Set([...opusFindings.patternsDetected, ...magnusResult.patterns])
    );

    const positivePatterns = allPatterns.filter(
      p => !['SPIRALE_CLARIFICATION', 'CHANCE_VS_COMPETENCE', 'CHAOS_INTERNE'].includes(p)
    );

    const harmonyScore =
      positivePatterns.length > 2
        ? 0.8 + magnusResult.harmonyScore * 0.2
        : magnusResult.harmonyScore;

    const therapyPhase = this.determineTherapyPhase(
      opusFindings.robustnessScore,
      allPatterns.length
    );

    const actionPlan = this.generateActionPlan(
      opusFindings.suggestedFixes,
      allPatterns
    );

    return {
      ...original,
      opusInsight: opusFindings.therapeuticInsight,
      newPatterns: allPatterns,
      robustness: opusFindings.robustnessScore,
      harmonyScore: Math.min(1, harmonyScore),
      actionPlan,
      therapyPhase,
      confidence:
        opusFindings.confidence > 0.8
          ? 'FORT'
          : opusFindings.confidence > 0.5
            ? 'MOYEN'
            : 'FAIBLE',
      timestamp: Date.now(),
    };
  }

  /**
   * Determine therapeutic phase (TCC model)
   */
  private determineTherapyPhase(robustness: number, patternCount: number): string {
    if (robustness < 50) {
      return 'Phase 1: AWARENESS - Identifying the spiral';
    } else if (robustness < 75) {
      return 'Phase 2: RESTRUCTURING - Building evidence';
    } else {
      return 'Phase 3: INTEGRATION - Embodied understanding';
    }
  }

  /**
   * Generate action plan from fixes
   */
  private generateActionPlan(
    fixes: OpusTherapeuticFindings['suggestedFixes'],
    patterns: string[]
  ): string[] {
    const plan: string[] = [];

    // Sort by severity
    const sorted = fixes.sort((a, b) => {
      const order = {
        CRITICAL: 0,
        HIGH: 1,
        MEDIUM: 2,
        LOW: 3,
        INFO: 4,
      };
      return order[a.severity] - order[b.severity];
    });

    for (const fix of sorted) {
      plan.push(`[${fix.severity}] ${fix.issue}`);
    }

    // Add pattern-specific recommendations
    if (patterns.includes('INCERTITUDE_REDUITE')) {
      plan.push('→ Continue accumulating evidence through tests');
    }
    if (patterns.includes('SPIRALE_CLARIFICATION')) {
      plan.push('→ Simplify nesting structure (flatten logic)');
    }
    if (patterns.includes('AUTO_REFLEXION')) {
      plan.push('→ Enhance self-observation (add more logging)');
    }

    return plan;
  }

  /**
   * Get statistics on therapeutic progress
   */
  public getTherapyStatistics(results: EnrichedMentalProcess[]) {
    return {
      totalSessions: results.length,
      averageRobustness:
        results.reduce((sum, r) => sum + r.robustness, 0) / results.length,
      averageHarmony:
        results.reduce((sum, r) => sum + r.harmonyScore, 0) / results.length,
      patternsEvolution: results.map(r => r.newPatterns.length),
      confidenceProgression: results.map(r => r.confidence),
    };
  }
}

export default MagnusOpusTherapeuticLoop;
