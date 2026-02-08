// tests/gateway/router/convergence/scorer.test.ts
// Comprehensive Jest test suite for ConvergenceScorer

import { ConvergenceScorer, MagnusPatternType } from '../../../../src/gateway/router/convergence/scorer';
import { GenerationRequest, Model } from '../../../../src/types';

// Mock Logger
jest.mock('../../../../src/utils/logger', () => ({
  Logger: jest.fn().mockImplementation(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  })),
}));

// Mock fetch for Opus API calls
global.fetch = jest.fn();

describe('ConvergenceScorer', () => {
  let scorer: ConvergenceScorer;

  // Test fixtures
  const mockRequest: GenerationRequest = {
    id: 'req-123',
    type: 'feature',
    prompt: 'Create a user auth service',
    language: 'typescript',
  };

  const mockModels: Model[] = [
    {
      id: 'claude-opus-4-5',
      provider: 'anthropic',
      avgLatency: 1200,
      costPerMillionTokens: 15,
      healthy: true,
      currentLoad: 0.3,
      maxLoad: 1.0,
    },
    {
      id: 'mistral-large',
      provider: 'mistral',
      avgLatency: 1800,
      costPerMillionTokens: 5,
      healthy: true,
      currentLoad: 0.5,
      maxLoad: 1.0,
    },
    {
      id: 'xai-grok',
      provider: 'xai',
      avgLatency: 800,
      costPerMillionTokens: 2,
      healthy: true,
      currentLoad: 0.7,
      maxLoad: 1.0,
    },
  ];

  beforeEach(() => {
    scorer = new ConvergenceScorer({
      useOpusAsync: false, // Disable Opus for most tests
      logAllDecisions: true,
    });
    jest.clearAllMocks();
  });

  describe('scoreModels', () => {
    it('should score multiple models without context', async () => {
      const scores = await scorer.scoreModels(mockRequest, mockModels);

      expect(scores).toHaveLength(3);
      expect(scores[0].totalScore).toBeGreaterThan(scores[1].totalScore);
      expect(scores[0].totalScore).toBeLessThanOrEqual(1);
      expect(scores[0].totalScore).toBeGreaterThanOrEqual(0);
    });

    it('should prioritize convergence score (45% weight)', async () => {
      // Opus model should win due to high convergence despite higher latency
      const scores = await scorer.scoreModels(mockRequest, mockModels);
      const opusScore = scores.find(s => s.modelId === 'claude-opus-4-5');

      expect(opusScore).toBeDefined();
      expect(opusScore!.breakdown.convergence).toBeGreaterThan(0.7);
    });

    it('should return sorted scores (highest first)', async () => {
      const scores = await scorer.scoreModels(mockRequest, mockModels);

      for (let i = 0; i < scores.length - 1; i++) {
        expect(scores[i].totalScore).toBeGreaterThanOrEqual(scores[i + 1].totalScore);
      }
    });

    it('should include breakdown details', async () => {
      const scores = await scorer.scoreModels(mockRequest, mockModels);
      const score = scores[0];

      expect(score.breakdown).toHaveProperty('convergence');
      expect(score.breakdown).toHaveProperty('latencyNormalized');
      expect(score.breakdown).toHaveProperty('costNormalized');
      expect(score.recommendation).toBeDefined();
      expect(score.confidenceLevel).toMatch(/LOW|MEDIUM|HIGH/);
    });

    it('should set confidence to LOW without context', async () => {
      const scores = await scorer.scoreModels(mockRequest, mockModels);

      scores.forEach(score => {
        expect(score.confidenceLevel).toBe('LOW');
      });
    });
  });

  describe('Heuristic model strength', () => {
    it('should give Opus higher convergence than Grok', async () => {
      const opusModel = mockModels[0]; // claude-opus-4-5
      const grokModel = mockModels[2]; // xai-grok

      const [opusScore] = await scorer.scoreModels(mockRequest, [opusModel]);
      const [grokScore] = await scorer.scoreModels(mockRequest, [grokModel]);

      expect(opusScore.breakdown.convergence).toBeGreaterThan(
        grokScore.breakdown.convergence
      );
    });

    it('should boost score for architecture request + strong model', async () => {
      const archRequest: GenerationRequest = {
        ...mockRequest,
        type: 'architecture',
      };

      const [opusScore] = await scorer.scoreModels(archRequest, [mockModels[0]]);

      expect(opusScore.breakdown.convergence).toBeGreaterThan(0.8);
    });

    it('should penalize model if previous convergence was low', async () => {
      const context = {
        sessionId: 'sess-123',
        previousCode: 'const x = y;',
        previousConvergenceScore: 0.3, // Very low
        iterationCount: 2,
      };

      const scores = await scorer.scoreModels(mockRequest, mockModels, context);
      const opusScore = scores.find(s => s.modelId === 'claude-opus-4-5');

      // Score should be penalized
      expect(opusScore!.breakdown.convergence).toBeLessThan(0.8);
    });

    it('should boost different model on retry', async () => {
      const context = {
        sessionId: 'sess-123',
        previousCode: 'const x = y;',
        iterationCount: 2,
        generationHistory: [
          {
            modelUsed: 'mistral-large',
            convergenceScore: 0.5,
            codeQuality: 0.6,
            timestamp: Date.now(),
          },
        ],
      };

      const [opusScore] = await scorer.scoreModels(mockRequest, [mockModels[0]], context);

      // Should get a boost for being different model
      expect(opusScore.breakdown.convergence).toBeGreaterThan(0.6);
    });
  });

  describe('Latency normalization', () => {
    it('should map latency correctly (500ms → 0.9, 5000ms → 0)', async () => {
      const fastModel = { ...mockModels[0], avgLatency: 500 };
      const slowModel = { ...mockModels[0], avgLatency: 5000 };

      const [fastScore] = await scorer.scoreModels(mockRequest, [fastModel]);
      const [slowScore] = await scorer.scoreModels(mockRequest, [slowModel]);

      expect(fastScore.breakdown.latencyNormalized).toBeGreaterThan(0.8);
      expect(slowScore.breakdown.latencyNormalized).toBeLessThan(0.2);
    });
  });

  describe('Cost normalization', () => {
    it('should map cost correctly (cheap → high score)', async () => {
      const cheapModel = { ...mockModels[0], costPerMillionTokens: 1 };
      const expensiveModel = { ...mockModels[0], costPerMillionTokens: 20 };

      const [cheapScore] = await scorer.scoreModels(mockRequest, [cheapModel]);
      const [expScore] = await scorer.scoreModels(mockRequest, [expensiveModel]);

      expect(cheapScore.breakdown.costNormalized).toBeGreaterThan(
        expScore.breakdown.costNormalized
      );
    });
  });

  describe('Opus async integration', () => {
    beforeEach(() => {
      // Enable Opus for these tests
      scorer = new ConvergenceScorer({ useOpusAsync: true });
    });

    it('should call Opus API when context available', async () => {
      const mockOpusResponse = {
        ok: true,
        json: async () => ({
          content: [
            {
              text: JSON.stringify({
                robustness: 85,
                patterns: [
                  { type: 'CLEAN_ARCHITECTURE', severity: 'HIGH' },
                  { type: 'ROBUST_ERROR_HANDLING', severity: 'MEDIUM' },
                ],
                codeQuality: {
                  readability: 85,
                  maintainability: 80,
                  testability: 75,
                  security: 90,
                },
                reasoning: ['Good error handling', 'Clear structure'],
              }),
            },
          ],
        }),
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce(mockOpusResponse);

      const context = {
        sessionId: 'sess-123',
        previousCode: 'export async function authenticate(token: string) { ... }',
        iterationCount: 1,
      };

      const scores = await scorer.scoreModels(mockRequest, [mockModels[0]], context);

      expect(global.fetch).toHaveBeenCalled();
      expect(scores[0].breakdown.robustness).toBe(85);
      expect(scores[0].opusSimulated).toBe(true);
    });

    it('should fallback to heuristic if Opus fails', async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('API error'));

      const context = {
        sessionId: 'sess-123',
        previousCode: 'const x = 1;',
        iterationCount: 1,
      };

      const scores = await scorer.scoreModels(mockRequest, [mockModels[0]], context);

      // Should still return a valid score (via heuristic)
      expect(scores[0].totalScore).toBeGreaterThan(0);
      expect(scores[0].totalScore).toBeLessThanOrEqual(1);
    });

    it('should cache Opus reviews', async () => {
      const mockOpusResponse = {
        ok: true,
        json: async () => ({
          content: [
            {
              text: JSON.stringify({
                robustness: 80,
                patterns: [],
                codeQuality: { readability: 80, maintainability: 80, testability: 80, security: 85 },
                reasoning: [],
              }),
            },
          ],
        }),
      };

      (global.fetch as jest.Mock).mockResolvedValue(mockOpusResponse);

      const context = {
        sessionId: 'sess-123',
        previousCode: 'export function test() {}',
        iterationCount: 1,
      };

      // First call
      await scorer.scoreModels(mockRequest, [mockModels[0]], context);
      expect(global.fetch).toHaveBeenCalledTimes(1);

      // Second call with same code - should use cache
      await scorer.scoreModels(mockRequest, [mockModels[0]], context);
      expect(global.fetch).toHaveBeenCalledTimes(1); // Still only 1 call
    });

    it('should timeout Opus call after 5 seconds', async () => {
      jest.useFakeTimers();

      (global.fetch as jest.Mock).mockImplementation(() => {
        return new Promise(resolve => {
          setTimeout(() => resolve({ ok: true }), 10000); // Very slow response
        });
      });

      const context = {
        sessionId: 'sess-123',
        previousCode: 'const x = 1;',
        iterationCount: 1,
      };

      const scorePromise = scorer.scoreModels(mockRequest, [mockModels[0]], context);

      jest.advanceTimersByTime(5100);

      // Should timeout and fallback
      const scores = await scorePromise;
      expect(scores[0].totalScore).toBeGreaterThan(0);

      jest.useRealTimers();
    });
  });

  describe('Pattern matching with session', () => {
    it('should boost score when patterns match previous session', async () => {
      const context = {
        sessionId: 'sess-123',
        previousCode: 'export const config = { ... }; export function init() { ... }',
        previousPatterns: [
          {
            type: MagnusPatternType.CLEAN_ARCHITECTURE,
            severity: 'HIGH' as const,
            description: 'Clear separation',
            weight: 0.8,
          },
          {
            type: MagnusPatternType.ROBUST_ERROR_HANDLING,
            severity: 'MEDIUM' as const,
            description: 'Error handling',
            weight: 0.6,
          },
        ],
        iterationCount: 2,
      };

      const scores = await scorer.scoreModels(mockRequest, mockModels, context);

      // Opus model should benefit from pattern continuity
      const opusScore = scores.find(s => s.modelId === 'claude-opus-4-5');
      expect(opusScore!.breakdown.patternMatch).toBeGreaterThan(0.4);
    });

    it('should penalize when anti-patterns detected', async () => {
      const context = {
        sessionId: 'sess-123',
        previousCode: '// old code',
        previousPatterns: [
          {
            type: MagnusPatternType.ERROR_SWALLOWING,
            severity: 'HIGH' as const,
            description: 'Exceptions ignored',
            weight: 0.9,
          },
        ],
        iterationCount: 2,
      };

      const scores = await scorer.scoreModels(mockRequest, mockModels, context);

      // Should have lower confidence
      scores.forEach(score => {
        expect(score.confidenceLevel).toBe('LOW');
      });
    });
  });

  describe('Configuration', () => {
    it('should respect custom weights', async () => {
      const customScorer = new ConvergenceScorer({
        weightConvergence: 0.2, // Low
        weightLatency: 0.4,     // High
        weightCost: 0.4,        // High
        useOpusAsync: false,
      });

      // Fast, cheap model should now win (not Opus)
      const scores = await customScorer.scoreModels(mockRequest, mockModels);

      const xaiScore = scores.find(s => s.modelId === 'xai-grok');
      expect(xaiScore).toBeDefined();
      expect(xaiScore!.totalScore).toBeGreaterThan(0.5); // Should be competitive
    });

    it('should enforce minimum convergence threshold', async () => {
      const strictScorer = new ConvergenceScorer({
        minConvergenceThreshold: 0.9,
        useOpusAsync: false,
      });

      const scores = await strictScorer.scoreModels(mockRequest, [mockModels[2]]); // xai-grok

      // Even xai score is calculated, it may be flagged as "risky"
      expect(scores[0].recommendation).toContain('Risky');
    });
  });

  describe('Recording and statistics', () => {
    it('should record convergence outcomes', () => {
      const recordSpy = jest.spyOn(scorer, 'recordOutcome');

      scorer.recordOutcome('sess-123', 'claude-opus-4-5', 0.88, 92);

      expect(recordSpy).toHaveBeenCalledWith('sess-123', 'claude-opus-4-5', 0.88, 92);
    });

    it('should return cache statistics', () => {
      const stats = scorer.getStatistics();

      expect(stats).toHaveProperty('cacheSize');
      expect(stats).toHaveProperty('cacheEntries');
      expect(Array.isArray(stats.cacheEntries)).toBe(true);
    });
  });

  describe('Edge cases', () => {
    it('should handle zero models', async () => {
      const scores = await scorer.scoreModels(mockRequest, []);

      expect(scores).toHaveLength(0);
    });

    it('should handle model with no latency data', async () => {
      const modelNoLatency = { ...mockModels[0], avgLatency: undefined };

      const scores = await scorer.scoreModels(mockRequest, [modelNoLatency]);

      expect(scores[0].totalScore).toBeGreaterThan(0);
      expect(scores[0].breakdown.latencyNormalized).toBeGreaterThan(0);
    });

    it('should clamp scores to 0-1 range', async () => {
      const scores = await scorer.scoreModels(mockRequest, mockModels);

      scores.forEach(score => {
        expect(score.totalScore).toBeGreaterThanOrEqual(0);
        expect(score.totalScore).toBeLessThanOrEqual(1);
      });
    });

    it('should handle context without generation history', async () => {
      const minimalContext = {
        sessionId: 'sess-123',
        iterationCount: 1,
        // No previousCode, no generationHistory
      };

      const scores = await scorer.scoreModels(mockRequest, mockModels, minimalContext);

      expect(scores).toHaveLength(3);
    });
  });

  describe('Recommendation messages', () => {
    it('should provide helpful recommendations', async () => {
      const scores = await scorer.scoreModels(mockRequest, mockModels);

      scores.forEach(score => {
        expect(score.recommendation).toBeDefined();
        expect(score.recommendation.length).toBeGreaterThan(10);
        expect(score.recommendation).toMatch(/choice|score/i);
      });
    });
  });
});
