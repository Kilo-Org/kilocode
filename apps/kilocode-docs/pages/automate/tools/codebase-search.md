# codebase_search

{% callout type="info" title="Setup Required" %}
The `codebase_search` tool is part of the [Codebase Indexing](/docs/features/codebase-indexing) feature. It requires additional setup including an embedding provider and vector database.
{% /callout %}

The `codebase_search` tool performs semantic searches across your entire codebase using AI embeddings. Unlike traditional text-based search, it understands the meaning of your queries and finds relevant code even when exact keywords don't match.

---

## Parameters

The tool accepts these parameters:

- `query` (required): Natural language search query describing what you're looking for
- `path` (optional): Directory path to limit search scope to a specific part of your codebase

---

## What It Does

This tool searches through your indexed codebase using semantic similarity rather than exact text matching. It finds code blocks that are conceptually related to your query, even if they don't contain the exact words you searched for. Results include relevant code snippets with file paths, line numbers, and similarity scores.

---

## When is it used?

- When Kilo Code needs to find code related to specific functionality across your project
- When looking for implementation patterns or similar code structures
- When searching for error handling, authentication, or other conceptual code patterns
- When exploring unfamiliar codebases to understand how features are implemented
- When finding related code that might be affected by changes or refactoring

---

## Key Features

- **Semantic Understanding**: Finds code by meaning rather than exact keyword matches
- **Cross-Project Search**: Searches across your entire indexed codebase, not just open files
- **Contextual Results**: Returns code snippets with file paths and line numbers for easy navigation
- **Similarity Scoring**: Results ranked by relevance with similarity scores (0-1 scale)
- **Scope Filtering**: Optional path parameter to limit searches to specific directories
- **Intelligent Ranking**: Results sorted by semantic relevance to your query
- **UI Integration**: Results displayed with syntax highlighting and navigation links
- **Performance Optimized**: Fast vector-based search with configurable result limits

---

## Requirements

This tool is only available when the Codebase Indexing feature is properly configured:

- **Feature Configured**: Codebase Indexing must be configured in settings
- **Embedding Provider**: OpenAI API key or Ollama configuration required
- **Vector Database**: Qdrant instance running and accessible
- **Index Status**: Codebase must be indexed (status: "Indexed" or "Indexing")

---

## Limitations

- **Requires Configuration**: Depends on external services (embedding provider + Qdrant)
- **Index Dependency**: Only searches through indexed code blocks
- **Result Limits**: Maximum of 50 results per search to maintain performance
- **Similarity Threshold**: Only returns results above similarity threshold (default: 0.4, configurable)
- **File Size Limits**: Limited to files under 1MB that were successfully indexed
- **Language Support**: Effectiveness depends on Tree-sitter language support

---

## How It Works

When the `codebase_search` tool is invoked, it follows this process:

1. **Availability Validation**:

    - Verifies that the CodeIndexManager is available and initialized
    - Confirms codebase indexing is enabled in settings
    - Checks that indexing is properly configured (API keys, Qdrant URL)
    - Validates the current index state allows searching

2. **Query Processing**:

    - Takes your natural language query and generates an embedding vector
    - Uses the same embedding provider configured for indexing (OpenAI or Ollama)
    - Converts the semantic meaning of your query into a mathematical representation

3. **Vector Search Execution**:

    - Searches the Qdrant vector database for similar code embeddings
    - Uses cosine similarity to find the most relevant code blocks
    - Applies the minimum similarity threshold (default: 0.4, configurable) to filter results
    - Limits results to 50 matches for optimal performance

4. **Path Filtering** (if specified):

    - Filters results to only include files within the specified directory path
    - Uses normalized path comparison for accurate filtering
    - Maintains relevance ranking within the filtered scope

5. **Result Processing and Formatting**:

    - Converts absolute file paths to workspace-relative paths
    - Structures results with file paths, line ranges, similarity scores, and code content
    - Formats for both AI consumption and UI display with syntax highlighting

6. **Dual Output Format**:
    - **AI Output**: Structured text format with query, file paths, scores, and code chunks
    - **UI Output**: JSON format with syntax highlighting and navigation capabilities

---

## Search Query Best Practices

### Effective Query Patterns

**Good: Conceptual and specific**

```xml
<codebase_search>
<query>user authentication and password validation</query>
</codebase_search>
```

**Good: Feature-focused**

```xml
<codebase_search>
<query>database connection pool setup</query>
</codebase_search>
```

**Good: Problem-oriented**

```xml
<codebase_search>
<query>error handling for API requests</query>
</codebase_search>
```

**Less effective: Too generic**

```xml
<codebase_search>
<query>function</query>
</codebase_search>
```

### Query Types That Work Well

- **Functional Descriptions**: "file upload processing", "email validation logic"
- **Technical Patterns**: "singleton pattern implementation", "factory method usage"
- **Domain Concepts**: "user profile management", "payment processing workflow"
- **Architecture Components**: "middleware configuration", "database migration scripts"

---

## Directory Scoping

Use the optional `path` parameter to focus searches on specific parts of your codebase:

**Search within API modules:**

```xml
<codebase_search>
<query>endpoint validation middleware</query>
<path>src/api</path>
</codebase_search>
```

**Search in test files:**

```xml
<codebase_search>
<query>mock data setup patterns</query>
<path>tests</path>
</codebase_search>
```

**Search specific feature directories:**

```xml
<codebase_search>
<query>component state management</query>
<path>src/components/auth</path>
</codebase_search>
```

---

## Result Interpretation

### Similarity Scores

- **0.8-1.0**: Highly relevant matches, likely exactly what you're looking for
- **0.6-0.8**: Good matches with strong conceptual similarity
- **0.4-0.6**: Potentially relevant but may require review
- **Below 0.4**: Filtered out as too dissimilar

### Result Structure

Each search result includes:

- **File Path**: Workspace-relative path to the file containing the match
- **Score**: Similarity score indicating relevance (0.4-1.0)
- **Line Range**: Start and end line numbers for the code block
- **Code Chunk**: The actual code content that matched your query

---

## Examples When Used

- When implementing a new feature, Kilo Code searches for "authentication middleware" to understand existing patterns before writing new code.
- When debugging an issue, Kilo Code searches for "error handling in API calls" to find related error patterns across the codebase.
- When refactoring code, Kilo Code searches for "database transaction patterns" to ensure consistency across all database operations.
- When onboarding to a new codebase, Kilo Code searches for "configuration loading" to understand how the application bootstraps.

---

## Usage Examples

Searching for authentication-related code across the entire project:

```xml
<codebase_search>
<query>user login and authentication logic</query>
</codebase_search>
```

Finding database-related code in a specific directory:

```xml
<codebase_search>
<query>database connection and query execution</query>
<path>src/data</path>
</codebase_search>
```

Looking for error handling patterns in API code:

```xml
<codebase_search>
<query>HTTP error responses and exception handling</query>
<path>src/api</path>
</codebase_search>
```

Searching for testing utilities and mock setups:

```xml
<codebase_search>
<query>test setup and mock data creation</query>
<path>tests</path>
</codebase_search>
```

Finding configuration and environment setup code:

```xml
<codebase_search>
<query>environment variables and application configuration</query>
</codebase_search>
```
