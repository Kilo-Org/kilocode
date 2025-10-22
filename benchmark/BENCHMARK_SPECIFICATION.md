# Codebase Indexing Benchmark Specification

## Executive Summary

This document specifies a comprehensive benchmarking strategy to compare three codebase indexing approaches:

1. **Managed Codebase Indexing** - Remote service via Kilo Org API
2. **Local Codebase Indexing** - Local embeddings + Qdrant vector store
3. **No Indexing (Baseline)** - Without semantic search capabilities

The benchmark will measure performance, quality, operational characteristics, user experience, and costs to inform product decisions and identify optimization opportunities.

---

## 1. Performance Metrics

### 1.1 Search Latency

**Objective**: Measure end-to-end search response times

| Metric           | Description                | Target  | Collection Method          |
| ---------------- | -------------------------- | ------- | -------------------------- |
| **Mean Latency** | Average search time        | <300ms  | High-resolution timestamps |
| **P50 Latency**  | Median search time         | <200ms  | Percentile calculation     |
| **P95 Latency**  | 95th percentile            | <500ms  | Percentile calculation     |
| **P99 Latency**  | 99th percentile            | <1000ms | Percentile calculation     |
| **Cold Start**   | First search after startup | <2000ms | Flag first search          |
| **Warm Cache**   | Subsequent searches        | <200ms  | Average after first        |

**Breakdown Components**:

- Query preprocessing time
- Embedding generation time (if applicable)
- Network round-trip time (Managed only)
- Vector search time
- Result formatting time

### 1.2 Indexing Performance

**Objective**: Measure initial and incremental indexing efficiency

| Metric                 | Description            | Target          | Collection Method             |
| ---------------------- | ---------------------- | --------------- | ----------------------------- |
| **Initial Index Time** | Full codebase indexing | <5min (medium)  | Start to completion timestamp |
| **Files/Second**       | Throughput rate        | >50 files/sec   | File count / duration         |
| **Blocks/Second**      | Code block processing  | >200 blocks/sec | Block count / duration        |
| **Incremental Update** | Single file reindex    | <5 seconds      | Per-file timing               |
| **Batch Update**       | Multiple file changes  | <30 seconds     | Batch timing                  |

**Codebase Size Categories**:

- **Small**: <1,000 files, <10MB
- **Medium**: 1,000-10,000 files, 10-100MB
- **Large**: >10,000 files, >100MB

### 1.3 Resource Consumption

**Objective**: Track system resource usage

| Metric             | Description           | Target              | Collection Method  |
| ------------------ | --------------------- | ------------------- | ------------------ |
| **Peak Memory**    | Maximum RAM usage     | <500MB              | Process monitoring |
| **Average Memory** | Typical RAM usage     | <200MB              | Periodic sampling  |
| **CPU Usage**      | Processor utilization | <50% average        | System metrics     |
| **Disk Space**     | Storage requirements  | <100MB (Local)      | File system stats  |
| **Network I/O**    | Bandwidth usage       | <10MB/min (Managed) | Network monitoring |

---

## 2. Quality Metrics

### 2.1 Search Accuracy

**Objective**: Evaluate relevance and ranking quality

| Metric           | Description                | Target | Collection Method          |
| ---------------- | -------------------------- | ------ | -------------------------- |
| **Precision@5**  | Relevant results in top 5  | >80%   | Manual evaluation          |
| **Precision@10** | Relevant results in top 10 | >70%   | Manual evaluation          |
| **Recall**       | % of relevant docs found   | >70%   | Ground truth comparison    |
| **MRR**          | Mean Reciprocal Rank       | >0.8   | Position of first relevant |
| **nDCG@10**      | Ranking quality score      | >0.75  | Graded relevance scores    |

**Relevance Grading Scale**:

- **3**: Highly relevant - Directly answers query
- **2**: Relevant - Related to query
- **1**: Marginally relevant - Tangentially related
- **0**: Not relevant - Unrelated

### 2.2 Result Quality

**Objective**: Assess result usefulness and consistency

| Metric                  | Description             | Target        | Collection Method       |
| ----------------------- | ----------------------- | ------------- | ----------------------- |
| **False Positive Rate** | Irrelevant results      | <20%          | Manual review           |
| **False Negative Rate** | Missed relevant code    | <30%          | Ground truth comparison |
| **Result Diversity**    | Unique files in results | >60%          | File path analysis      |
| **Score Distribution**  | Similarity score spread | 0.5-1.0 range | Statistical analysis    |
| **Consistency**         | Same query stability    | >90% overlap  | Repeated queries        |

---

## 3. Operational Metrics

### 3.1 Reliability

**Objective**: Measure system stability and error handling

| Metric            | Description                | Target     | Collection Method    |
| ----------------- | -------------------------- | ---------- | -------------------- |
| **Success Rate**  | Successful operations      | >99%       | Success/total ratio  |
| **Error Rate**    | Failed operations          | <1%        | Error count tracking |
| **Timeout Rate**  | Operations exceeding limit | <0.5%      | Timeout detection    |
| **Retry Success** | Successful retries         | >95%       | Retry tracking       |
| **MTBF**          | Mean time between failures | >7 days    | Failure timestamps   |
| **MTTR**          | Mean time to recovery      | <5 minutes | Recovery timestamps  |

**Error Categories**:

- Network errors (Managed only)
- Embedding generation failures
- Vector store errors
- Configuration errors
- Resource exhaustion

### 3.2 Scalability

**Objective**: Test performance across different scales

| Test Scenario      | Codebase Size | Concurrent Users | Expected Performance |
| ------------------ | ------------- | ---------------- | -------------------- |
| **Small Project**  | 500 files     | 1 user           | <100ms search        |
| **Medium Project** | 5,000 files   | 5 users          | <300ms search        |
| **Large Project**  | 20,000 files  | 10 users         | <500ms search        |
| **Monorepo**       | 50,000 files  | 20 users         | <1000ms search       |

### 3.3 Maintenance

**Objective**: Evaluate operational overhead

| Metric                | Description           | Target      | Collection Method   |
| --------------------- | --------------------- | ----------- | ------------------- |
| **Setup Time**        | Initial configuration | <30 minutes | Timed setup         |
| **Config Complexity** | Steps required        | <10 steps   | Documentation count |
| **Update Frequency**  | Reindex necessity     | <1/week     | Change tracking     |
| **Index Staleness**   | Time until outdated   | >1 hour     | Drift detection     |
| **Recovery Time**     | Rebuild after failure | <10 minutes | Recovery timing     |

---

## 4. User Experience Metrics

### 4.1 Perceived Performance

**Objective**: Measure user-facing responsiveness

| Metric                   | Description               | Target    | Collection Method |
| ------------------------ | ------------------------- | --------- | ----------------- |
| **Time to First Result** | Initial feedback          | <100ms    | UI timing         |
| **Progressive Loading**  | Streaming results         | Supported | Feature flag      |
| **UI Responsiveness**    | Editor lag                | <50ms     | Input latency     |
| **Background Impact**    | Dev workflow interference | Minimal   | User surveys      |

### 4.2 Usability

**Objective**: Track user interaction patterns

| Metric                   | Description             | Target     | Collection Method         |
| ------------------------ | ----------------------- | ---------- | ------------------------- |
| **Query Success Rate**   | Queries finding results | >85%       | Result count tracking     |
| **Reformulation Rate**   | Query retries           | <30%       | Sequential query tracking |
| **Click-Through Rate**   | Results used            | >40%       | Click tracking            |
| **Task Completion Time** | Time to find code       | <2 minutes | Task timing               |
| **User Satisfaction**    | Rating score            | >4/5       | Survey responses          |

---

## 5. Cost Metrics

### 5.1 Direct Costs

**Objective**: Calculate monetary expenses

| Cost Component       | Managed           | Local                     | Baseline |
| -------------------- | ----------------- | ------------------------- | -------- |
| **Embedding API**    | $0.0001/1K tokens | $0 (Ollama) or $0.0001/1K | $0       |
| **Vector Storage**   | $0.25/GB/month    | $0 (self-hosted)          | $0       |
| **Network Transfer** | $0.09/GB          | $0                        | $0       |
| **Infrastructure**   | $0                | $20/month (server)        | $0       |
| **Total (est.)**     | $5-15/dev/month   | $20/team/month            | $0       |

**Cost Calculation Factors**:

- Average codebase size: 10,000 files
- Average file size: 5KB
- Embedding dimension: 1536 (OpenAI)
- Search frequency: 50 queries/day/developer
- Team size: 10 developers

### 5.2 Indirect Costs

**Objective**: Estimate time and opportunity costs

| Cost Component          | Managed      | Local         | Baseline   |
| ----------------------- | ------------ | ------------- | ---------- |
| **Setup Time**          | 15 minutes   | 60 minutes    | 0 minutes  |
| **Maintenance**         | 30 min/month | 2 hours/month | 0          |
| **Developer Wait Time** | 5 min/day    | 5 min/day     | 15 min/day |
| **Opportunity Cost**    | Low          | Medium        | High       |

---

## 6. Test Scenarios

### 6.1 Query Types

**Objective**: Test diverse search patterns

#### Exact Match Queries

```
- "UserAuthenticationService"
- "validatePassword function"
- "DatabaseConnection class"
```

#### Semantic Queries

```
- "How is user authentication handled?"
- "Database connection setup and pooling"
- "Error handling for API requests"
- "Logging configuration"
```

#### Cross-File Pattern Queries

```
- "Event emitter implementations"
- "Middleware functions for Express"
- "React component lifecycle methods"
- "Test fixtures and mocks"
```

#### Ambiguous Queries

```
- "handler" (could be event, error, request, etc.)
- "config" (many configuration files)
- "utils" (utility functions everywhere)
```

#### Long-Tail Queries

```
- "WebSocket reconnection logic with exponential backoff"
- "CSV parsing with custom delimiter handling"
- "OAuth2 token refresh flow implementation"
```

#### Multi-Language Queries

```
- "TypeScript interface definitions"
- "Python data models"
- "SQL migration scripts"
- "Markdown documentation"
```

### 6.2 Codebase Conditions

**Test Environments**:

1. **Fresh Index**: Just completed full indexing
2. **Stale Index**: 100+ file changes since last index
3. **Partial Index**: During incremental updates
4. **Large Files**: Files approaching 1MB limit
5. **Many Small Files**: 10,000+ files <1KB each
6. **Monorepo**: Multiple projects in workspace
7. **Mixed Languages**: TypeScript, Python, Go, Rust
8. **Heavy Dependencies**: Large node_modules, vendor dirs

### 6.3 Load Patterns

**Traffic Simulations**:

| Pattern            | Description           | Duration  | Queries/Min |
| ------------------ | --------------------- | --------- | ----------- |
| **Single User**    | Individual developer  | 1 hour    | 5           |
| **Team Usage**     | 10 concurrent users   | 1 hour    | 50          |
| **Burst Traffic**  | Spike in searches     | 5 minutes | 200         |
| **Sustained Load** | Continuous background | 8 hours   | 20          |
| **Peak Hours**     | High activity period  | 2 hours   | 100         |

---

## 7. Data Collection Strategy

### 7.1 Instrumentation Points

**Events to Capture**:

```typescript
interface BenchmarkEvent {
  timestamp: number
  eventType: string
  mode: 'managed' | 'local' | 'baseline'
  metadata: Record<string, any>
}

// Search Events
{
  type: 'search_started',
  query: string,
  path?: string,
  mode: string
}

{
  type: 'embedding_generated',
  duration: number,
  tokenCount: number,
  model: string
}

{
  type: 'vector_search_completed',
  duration: number,
  resultCount: number,
  scores: number[]
}

{
  type: 'search_completed',
  totalDuration: number,
  resultCount: number,
  success: boolean
}

// Indexing Events
{
  type: 'indexing_started',
  fileCount: number,
  totalSize: number
}

{
  type: 'file_processed',
  filePath: string,
  blockCount: number,
  duration: number
}

{
  type: 'indexing_completed',
  duration: number,
  blocksIndexed: number,
  errors: number
}

// Error Events
{
  type: 'error_occurred',
  errorType: string,
  message: string,
  stack: string,
  context: Record<string, any>
}
```

### 7.2 Metrics Collection

**Collection Methods**:

1. **Performance Timing**

    - Use `performance.now()` for high-resolution timestamps
    - Capture start/end times for all operations
    - Calculate durations and percentiles

2. **Resource Monitoring**

    - Sample memory usage every 5 seconds
    - Track CPU usage via process metrics
    - Monitor disk I/O and network traffic

3. **Result Metadata**

    - Store all search results with scores
    - Track file paths and line ranges
    - Record relevance judgments

4. **Error Tracking**

    - Log all errors with full context
    - Categorize error types
    - Track recovery attempts

5. **User Interactions**
    - Log query patterns
    - Track result clicks
    - Measure task completion

### 7.3 Data Storage

**Storage Structure**:

```
benchmark/results/
├── raw/
│   ├── managed/
│   │   ├── run-001-2024-01-15.jsonl
│   │   ├── run-002-2024-01-15.jsonl
│   │   └── ...
│   ├── local/
│   │   ├── run-001-2024-01-15.jsonl
│   │   └── ...
│   └── baseline/
│       ├── run-001-2024-01-15.jsonl
│       └── ...
├── processed/
│   ├── aggregated-metrics.json
│   ├── percentiles.json
│   └── cost-analysis.json
└── reports/
    ├── comparison-report.md
    ├── charts/
    │   ├── latency-comparison.png
    │   ├── cost-comparison.png
    │   └── quality-comparison.png
    └── summary.json
```

---

## 8. Success Criteria

### 8.1 Performance Targets

| Metric                 | Managed | Local  | Baseline |
| ---------------------- | ------- | ------ | -------- |
| **P95 Search Latency** | <500ms  | <300ms | N/A      |
| **Initial Index Time** | <3 min  | <5 min | N/A      |
| **Memory Usage**       | <300MB  | <500MB | <50MB    |
| **Success Rate**       | >99%    | >99.5% | N/A      |

### 8.2 Quality Targets

| Metric                | Managed | Local | Baseline |
| --------------------- | ------- | ----- | -------- |
| **Precision@5**       | >80%    | >80%  | N/A      |
| **Recall**            | >70%    | >70%  | N/A      |
| **MRR**               | >0.8    | >0.8  | N/A      |
| **User Satisfaction** | >4/5    | >4/5  | N/A      |

### 8.3 Cost Targets

| Metric               | Managed     | Local           |
| -------------------- | ----------- | --------------- |
| **Monthly Cost/Dev** | <$10        | <$2 (amortized) |
| **Setup Time**       | <30 min     | <60 min         |
| **Maintenance**      | <1 hr/month | <2 hr/month     |

### 8.4 Decision Criteria

**Managed vs Local Trade-offs**:

| Factor            | Managed Advantage               | Local Advantage              |
| ----------------- | ------------------------------- | ---------------------------- |
| **Performance**   | Lower latency (optimized infra) | No network dependency        |
| **Cost**          | Pay-per-use, no infra           | One-time setup, no API costs |
| **Maintenance**   | Fully managed                   | Full control                 |
| **Privacy**       | Shared with service             | Fully local                  |
| **Collaboration** | Shared team index               | Individual indexes           |
| **Scalability**   | Automatic scaling               | Manual scaling               |

**Recommendation Framework**:

- **Choose Managed if**:

    - Team size >5 developers
    - Shared index benefits important
    - Low maintenance preference
    - Network reliability high
    - Budget allows API costs

- **Choose Local if**:
    - Privacy/security critical
    - Network unreliable
    - One-time cost preferred
    - Full control needed
    - Technical expertise available

---

## 9. Statistical Analysis

### 9.1 Comparison Methods

**Statistical Tests**:

1. **Latency Comparison**

    - Mann-Whitney U test (non-parametric)
    - Confidence intervals (95%)
    - Effect size (Cohen's d)

2. **Quality Comparison**

    - Chi-square test for precision/recall
    - Paired t-test for MRR
    - Bootstrap confidence intervals

3. **Cost Comparison**
    - Total cost of ownership (TCO) analysis
    - Break-even analysis
    - Sensitivity analysis

### 9.2 Visualization

**Charts to Generate**:

1. **Latency Distribution**

    - Box plots for each mode
    - Violin plots showing distribution
    - CDF curves for percentiles

2. **Quality Metrics**

    - Bar charts for precision/recall
    - Scatter plots for score distribution
    - Heatmaps for query type performance

3. **Cost Analysis**

    - Stacked bar charts for cost breakdown
    - Line charts for cost over time
    - Pie charts for cost allocation

4. **Resource Usage**
    - Time series for memory/CPU
    - Area charts for cumulative usage
    - Comparison bars for peak usage

### 9.3 Reporting

**Report Structure**:

1. **Executive Summary**

    - Key findings
    - Recommendations
    - Decision matrix

2. **Detailed Results**

    - Performance analysis
    - Quality analysis
    - Cost analysis
    - Operational analysis

3. **Appendices**
    - Raw data tables
    - Statistical test results
    - Methodology details
    - Limitations and caveats

---

## 10. Implementation Plan

### 10.1 Phase 1: Infrastructure (Week 1)

- [ ] Create benchmark directory structure
- [ ] Implement metrics collector
- [ ] Build test query database
- [ ] Set up data storage
- [ ] Create configuration system

### 10.2 Phase 2: Test Runners (Week 2)

- [ ] Implement managed indexing runner
- [ ] Implement local indexing runner
- [ ] Implement baseline runner
- [ ] Add load simulation
- [ ] Integrate telemetry

### 10.3 Phase 3: Execution (Week 3)

- [ ] Run small codebase tests
- [ ] Run medium codebase tests
- [ ] Run large codebase tests
- [ ] Run load pattern tests
- [ ] Collect all metrics

### 10.4 Phase 4: Analysis (Week 4)

- [ ] Process raw data
- [ ] Calculate statistics
- [ ] Generate visualizations
- [ ] Write comparison report
- [ ] Present findings

---

## 11. Limitations and Considerations

### 11.1 Known Limitations

1. **Benchmark Environment**

    - May not reflect production conditions
    - Network conditions vary
    - Hardware differences impact results

2. **Query Selection**

    - Synthetic queries may not match real usage
    - Relevance judgments are subjective
    - Limited query diversity

3. **Codebase Selection**
    - Test codebases may not be representative
    - Language distribution matters
    - Project structure varies

### 11.2 Mitigation Strategies

1. **Multiple Runs**

    - Run each test 10+ times
    - Calculate confidence intervals
    - Identify and remove outliers

2. **Real-World Validation**

    - Collect actual user queries
    - Use production codebases
    - Validate with user studies

3. **Controlled Variables**
    - Same hardware for all tests
    - Same network conditions
    - Same time of day

### 11.3 Future Enhancements

1. **Expanded Metrics**

    - Code understanding quality
    - Task completion success
    - Developer productivity impact

2. **Additional Scenarios**

    - Multi-workspace indexing
    - Cross-repository search
    - Historical code search

3. **Advanced Analysis**
    - Machine learning for relevance
    - A/B testing framework
    - Continuous benchmarking

---

## 12. Appendix

### 12.1 Sample Test Queries

See [`benchmark/scenarios/queries.json`](./scenarios/queries.json) for complete query database.

### 12.2 Ground Truth Dataset

See [`benchmark/scenarios/ground-truth.json`](./scenarios/ground-truth.json) for relevance judgments.

### 12.3 Configuration Templates

See [`benchmark/config/`](./config/) for configuration examples.

### 12.4 References

- [Information Retrieval Evaluation](https://nlp.stanford.edu/IR-book/html/htmledition/evaluation-of-ranked-retrieval-results-1.html)
- [Qdrant Benchmarks](https://qdrant.tech/benchmarks/)
- [OpenAI Embeddings Guide](https://platform.openai.com/docs/guides/embeddings)
- [Vector Search Best Practices](https://www.pinecone.io/learn/vector-search/)

---

## Document History

| Version | Date       | Author    | Changes               |
| ------- | ---------- | --------- | --------------------- |
| 1.0     | 2024-01-15 | Kilo Code | Initial specification |

---

**Next Steps**: Review this specification, provide feedback, and approve before proceeding to implementation phase.
