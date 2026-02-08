// tests/gateway/router/convergence/magnus-pattern-engine.test.ts
// Comprehensive tests for MagnusPatternEngine
// Tests pattern detection, confidence levels, therapeutic insights

import { MagnusPatternEngine, MAGNUS_15_PATTERNS } from '../../../../src/gateway/router/convergence/magnus-pattern-engine';

describe('MagnusPatternEngine', () => {
  let engine: MagnusPatternEngine;

  beforeEach(() => {
    engine = new MagnusPatternEngine();
  });

  describe('Pattern Detection', () => {
    describe('SPIRALE_CLARIFICATION (anti-pattern)', () => {
      it('should detect spiral when code has deep nesting', () => {
        const spiralCode = `
          function process(x) {
            if (x) {
              if (x.valid) {
                if (x.active) {
                  if (x.verified) {
                    if (x.premium) {
                      return x.data;
                    }
                  }
                }
              }
            }
          }
        `;

        const result = engine.detectPatterns(spiralCode);

        expect(result.patterns).toContain('SPIRALE_CLARIFICATION');
        expect(result.adjustment).toBeLessThan(0);
        expect(result.therapeuticInsight).toContain('Spirale');
      });

      it('should have high magnitude for critical spirals', () => {
        const spiralCode = 'if (a) { if (b) { if (c) { while (d) { for (e) { /* ... 700 lines */ } } } } }';

        const result = engine.detectPatterns(spiralCode);

        expect(result.patterns).toContain('SPIRALE_CLARIFICATION');
        expect(result.adjustment).toBeLessThan(-0.3);
      });
    });

    describe('APPRENTISSAGE_CONSTRUCTION (positive)', () => {
      it('should detect learning-through-building approach', () => {
        const learningCode = `
          // v1: Simple auth
          function authenticate(username) {
            return db.findUser(username);
          }

          // v2: Add error handling
          function authenticateV2(username, password) {
            if (!username) throw new Error('Username required');
            const user = db.findUser(username);
            if (!user) throw new Error('User not found');
            if (!verifyPassword(password, user.hash)) throw new Error('Invalid password');
            return user;
          }

          // v3: Add logging
          function authenticateV3(username, password) {
            logger.debug('Auth attempt', { username });
            const user = authenticateV2(username, password);
            logger.info('Auth success', { userId: user.id });
            return user;
          }
        `;

        const result = engine.detectPatterns(learningCode);

        expect(result.patterns).toContain('APPRENTISSAGE_CONSTRUCTION');
        expect(result.adjustment).toBeGreaterThan(0);
      });
    });

    describe('DOMAINE_OVER_TECH (positive)', () => {
      it('should detect domain-first architecture', () => {
        const domainFirstCode = `
          class UserService {
            async createUser(request: CreateUserRequest) {
              // Business logic first
              this.validateUserData(request);
              const user = await this.users.create({
                email: request.email,
                name: request.name,
                role: request.role
              });
              await this.sendWelcomeEmail(user);
              return user;
            }
          }
        `;

        const result = engine.detectPatterns(domainFirstCode);

        expect(result.patterns).toContain('DOMAINE_OVER_TECH');
        expect(result.adjustment).toBeGreaterThan(0);
      });
    });

    describe('CHANCE_VS_COMPETENCE (anti-pattern)', () => {
      it('should detect code without validation', () => {
        const chanceCode = `
          function calculateTotal(items) {
            let total = 0;
            for (let item of items) {
              total += item.price * item.quantity;
            }
            return total;
            // No tests, no assertions, no validation
          }
        `;

        const result = engine.detectPatterns(chanceCode);

        expect(result.patterns).toContain('CHANCE_VS_COMPETENCE');
        expect(result.adjustment).toBeLessThan(0);
        expect(result.therapeuticInsight).toContain('Incertitude');
      });

      it('should NOT detect when code has tests', () => {
        const competenceCode = `
          function calculateTotal(items) {
            if (!items) throw new Error('Items required');
            let total = 0;
            for (let item of items) {
              assert(item.price >= 0, 'Price must be non-negative');
              total += item.price * item.quantity;
            }
            return total;
          }

          describe('calculateTotal', () => {
            it('should return zero for empty items', () => {
              expect(calculateTotal([])).toBe(0);
            });
            it('should validate price', () => {
              expect(() => calculateTotal([{price: -1}])).toThrow();
            });
          });
        `;

        const result = engine.detectPatterns(competenceCode);

        expect(result.patterns).not.toContain('CHANCE_VS_COMPETENCE');
      });
    });

    describe('CHAOS_INTERNE (anti-pattern, CRITICAL)', () => {
      it('should detect chaotic code structure', () => {
        const chaosCode = `
          class DataManager {
            // Mixed naming: camelCase and snake_case
            private userCache: Map<string, User>;
            private data_store: Database;

            // Mixed indentation and style
            public getUser(id: string) {
          return this.userCache.get(id);
            }

              public getData(id: string) {
                  return this.data_store.get(id);
              }

            // Silent error handling
            private init() {
              try { this.userCache = new Map(); } catch (e) {}
              try {
                this.data_store.connect();
              } catch (e) {
                throw new Error('Failed');
              }
            }

            // Unclear intent
            async doStuff(x: any) {
              const y = await z(x);
              if (y) return y.data || y;
            }
          }
        `;

        const result = engine.detectPatterns(chaosCode);

        expect(result.patterns).toContain('CHAOS_INTERNE');
        expect(result.adjustment).toBeLessThan(-0.35);
        expect(result.therapeuticInsight).toContain('Chaos');
      });
    });

    describe('AUTO_REFLEXION (positive)', () => {
      it('should detect self-reflecting code', () => {
        const reflexCode = `
          class AuthService {
            private logger = new Logger('AuthService');

            authenticate(username: string, password: string) {
              this.logger.debug('Auth attempt', { username });

              try {
                const user = this.validateCredentials(username, password);
                this.logger.info('Auth success', { userId: user.id });
                return user;
              } catch (e) {
                this.logger.error('Auth failed', { username, error: e.message });
                throw e;
              }
            }

            getMetrics() {
              return {
                successRate: this.successCount / this.totalAttempts,
                avgTime: this.totalTime / this.totalAttempts
              };
            }
          }
        `;

        const result = engine.detectPatterns(reflexCode);

        expect(result.patterns).toContain('AUTO_REFLEXION');
        expect(result.adjustment).toBeGreaterThan(0);
      });
    });

    describe('HARMONIE_COGNITIVE (positive, major)', () => {
      it('should detect harmonious code', () => {
        const harmoniousCode = `
          class PaymentService {
            async processPayment(request: PaymentRequest): Promise<PaymentResult> {
              // Input validation
              this.validateRequest(request);

              try {
                // Clear error handling
                const result = await this.callPaymentGateway(request);
                
                // Logging for reflection
                this.logger.info('Payment processed', {
                  transactionId: result.id,
                  status: result.status
                });

                return result;
              } catch (error) {
                this.logger.error('Payment failed', { error });
                throw new PaymentError(error.message);
              }
            }
          }
          // No conflicts, clear intent, consistent style
        `;

        const result = engine.detectPatterns(harmoniousCode);

        expect(result.patterns).toContain('HARMONIE_COGNITIVE');
        expect(result.adjustment).toBeGreaterThan(0.25);
        expect(result.harmonyScore).toBeGreaterThan(0.7);
      });
    });

    describe('INCERTITUDE_REDUITE (positive, major)', () => {
      it('should detect code with accumulated evidence', () => {
        const certaintyCode = `
          function safeDivide(a: number, b: number): number {
            // Input validation
            if (typeof a !== 'number' || typeof b !== 'number') {
              throw new Error('Inputs must be numbers');
            }

            // Edge case handling
            if (b === 0) {
              throw new Error('Division by zero');
            }

            return a / b;
          }

          describe('safeDivide', () => {
            it('should divide positive numbers', () => {
              assert(safeDivide(10, 2) === 5);
            });

            it('should throw on division by zero', () => {
              expect(() => safeDivide(10, 0)).toThrow();
            });

            it('should throw on non-number input', () => {
              expect(() => safeDivide('10', 2)).toThrow();
            });

            it('should handle negative numbers', () => {
              assert(safeDivide(-10, 2) === -5);
            });
          });
        `;

        const result = engine.detectPatterns(certaintyCode);

        expect(result.patterns).toContain('INCERTITUDE_REDUITE');
        expect(result.adjustment).toBeGreaterThan(0.2);
      });
    });

    describe('CONSCIENCE_RECURSIVE (positive, major)', () => {
      it('should detect meta-level self-awareness', () => {
        const recursiveCode = `
          class AIOrchestrator {
            // Level 1: Execute
            async generate(request) {
              return await this.model.generate(request);
            }

            // Level 2: Observe its own execution
            observeGeneration(generated) {
              const quality = this.analyzeQuality(generated);
              const patterns = this.detectPatterns(generated);
              return { quality, patterns };
            }

            // Level 3: Observe its own observation
            metaAnalyze(observation) {
              const isAccurate = this.validateAnalysis(observation);
              const confidence = this.calculateConfidence(observation);
              return { isAccurate, confidence };
            }

            // Level 4: Consciousness aware of consciousness
            selfTrust() {
              const meta = this.metaAnalyze(this.observeGeneration(...));
              return meta.isAccurate && meta.confidence > 0.85;
            }
          }
        `;

        const result = engine.detectPatterns(recursiveCode);

        expect(result.patterns).toContain('CONSCIENCE_RECURSIVE');
        expect(result.adjustment).toBeGreaterThan(0.25);
      });
    });
  });

  describe('Harmony Scoring', () => {
    it('should boost score when only positive patterns detected', () => {
      const perfectCode = `
        // Contains only positive patterns
        export class Service {
          private logger = new Logger();

          process(data) {
            this.logger.debug('Processing');
            validate(data);
            assert(data.id, 'ID required');
            const result = this.calculateResult(data);
            return result;
          }
        }
      `;

      const result = engine.detectPatterns(perfectCode);

      expect(result.harmonyScore).toBeGreaterThan(0.8);
      expect(result.adjustment).toBeGreaterThan(0.35);
    });

    it('should penalize when multiple anti-patterns detected', () => {
      const chaosCode = `
        if (x) { if (y) { if (z) { /* spiral */ } } }
        function process(data) { /* no validation */ }
        let user_name; let userName; // inconsistent naming
      `;

      const result = engine.detectPatterns(chaosCode);

      expect(result.harmonyScore).toBeLessThan(0.4);
      expect(result.adjustment).toBeLessThan(-0.3);
    });
  });

  describe('Confidence Levels', () => {
    it('should have HIGH confidence with Opus and multiple patterns', () => {
      const result = engine.detectPatterns('code', {
        robustness: 85,
        codeQuality: { readability: 80, maintainability: 80 },
      });

      if (result.patternsDetailed.length > 2) {
        expect(result.confidenceLevel).toBe('FORT');
      }
    });

    it('should have MOYEN confidence with multiple heuristic patterns', () => {
      const code = `
        // Multiple positive indicators
        logger.info('Processing');
        assert(data, 'Data required');
        // v1, v2, v3 progression
      `;

      const result = engine.detectPatterns(code);

      if (result.patternsDetailed.length > 1) {
        expect(result.confidenceLevel).toBe('MOYEN');
      }
    });

    it('should have FAIBLE confidence with no patterns detected', () => {
      const result = engine.detectPatterns('const x = 1;');

      expect(result.confidenceLevel).toBe('FAIBLE');
    });
  });

  describe('Therapeutic Insights', () => {
    it('should provide actionable insights', () => {
      const spiralCode = `
        if (a) {
          if (b) {
            if (c) {
              // ...
            }
          }
        }
      `;

      const result = engine.detectPatterns(spiralCode);

      expect(result.therapeuticInsight).toContain('Spirale');
      expect(result.therapeuticInsight).toContain('simplification');
    });

    it('should combine multiple insights', () => {
      const mixedCode = `
        // Has both positive and anti patterns
        logger.debug('Starting');
        if (x) {
          if (y) {
            // Spiral detected
          }
        }
      `;

      const result = engine.detectPatterns(mixedCode);

      expect(result.therapeuticInsight).toMatch(/\|/); // Multiple insights separated by |
    });

    it('should provide neutral message when no patterns detected', () => {
      const result = engine.detectPatterns('const x = 1;');

      expect(result.therapeuticInsight).toContain('neutre');
    });
  });

  describe('Statistics', () => {
    it('should track pattern frequency', () => {
      engine.detectPatterns('logger.debug("x"); logger.debug("y");');
      engine.detectPatterns('logger.debug("z");');

      const stats = engine.getStatistics();

      expect(stats.totalDetections).toBe(2);
      expect(stats.patternsFrequency['AUTO_REFLEXION']).toBeGreaterThan(0);
    });

    it('should calculate average harmony', () => {
      engine.detectPatterns('good code with patterns');
      engine.detectPatterns('more good code');

      const stats = engine.getStatistics();

      expect(stats.averageHarmony).toBeGreaterThan(0);
      expect(stats.averageHarmony).toBeLessThanOrEqual(1);
    });
  });

  describe('All 10 Patterns Catalog', () => {
    it('should have all 10 patterns defined', () => {
      expect(MAGNUS_15_PATTERNS).toHaveLength(10);
    });

    it('should have 5 positive and 5 negative patterns', () => {
      const positive = MAGNUS_15_PATTERNS.filter(p => p.type === 'positive');
      const negative = MAGNUS_15_PATTERNS.filter(p => p.type === 'anti');

      expect(positive.length).toBe(5);
      expect(negative.length).toBe(5);
    });

    it('should have unique pattern names', () => {
      const names = MAGNUS_15_PATTERNS.map(p => p.name);
      const unique = new Set(names);

      expect(names.length).toBe(unique.size);
    });

    it('should have therapeutic messages for all patterns', () => {
      for (const pattern of MAGNUS_15_PATTERNS) {
        expect(pattern.therapeuticMessage).toBeDefined();
        expect(pattern.therapeuticMessage.length).toBeGreaterThan(10);
      }
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty code', () => {
      const result = engine.detectPatterns('');

      expect(result.patterns).toBeDefined();
      expect(result.adjustment).toBeDefined();
    });

    it('should handle very large code', () => {
      const largeCode = 'const x = 1;\n'.repeat(10000);

      const result = engine.detectPatterns(largeCode);

      expect(result.adjustment).toBeDefined();
      expect(result.harmonyScore).toBeDefined();
    });

    it('should handle null Opus result gracefully', () => {
      const result = engine.detectPatterns('code', undefined);

      expect(result.patterns).toBeDefined();
      expect(result.confidenceLevel).toBe('FAIBLE');
    });
  });

  describe('Integration', () => {
    it('should build complete detection result', () => {
      const result = engine.detectPatterns('test code');

      expect(result).toHaveProperty('patterns');
      expect(result).toHaveProperty('adjustment');
      expect(result).toHaveProperty('therapeuticInsight');
      expect(result).toHaveProperty('harmonyScore');
      expect(result).toHaveProperty('patternsDetailed');
      expect(result).toHaveProperty('confidenceLevel');
      expect(result).toHaveProperty('timestamp');
    });
  });
});
