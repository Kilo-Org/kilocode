// kilocode_change - new file
// SQLite schema for native codebase graph storage

export const GRAPH_SCHEMA = `
CREATE TABLE IF NOT EXISTS graph_nodes (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  signature TEXT,
  language TEXT,
  parent_id TEXT,
  metadata TEXT,
  created_at INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS graph_edges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_node TEXT NOT NULL,
  to_node TEXT NOT NULL,
  kind TEXT NOT NULL,
  file_path TEXT NOT NULL,
  line INTEGER NOT NULL,
  column INTEGER,
  created_at INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS symbol_table (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  node_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  kind TEXT NOT NULL,
  scope_id TEXT,
  is_exported INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS import_map (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path TEXT NOT NULL,
  source_path TEXT NOT NULL,
  imported_name TEXT,
  local_name TEXT,
  is_default INTEGER DEFAULT 0,
  is_namespace INTEGER DEFAULT 0,
  line INTEGER
);

CREATE TABLE IF NOT EXISTS graph_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_nodes_file ON graph_nodes(file_path);
CREATE INDEX IF NOT EXISTS idx_nodes_kind_name ON graph_nodes(kind, name);
CREATE INDEX IF NOT EXISTS idx_nodes_parent ON graph_nodes(parent_id);
CREATE INDEX IF NOT EXISTS idx_edges_from ON graph_edges(from_node, kind);
CREATE INDEX IF NOT EXISTS idx_edges_to ON graph_edges(to_node, kind);
CREATE INDEX IF NOT EXISTS idx_edges_kind ON graph_edges(kind);
CREATE INDEX IF NOT EXISTS idx_edges_file ON graph_edges(file_path);
CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbol_table(name);
CREATE INDEX IF NOT EXISTS idx_symbols_node ON symbol_table(node_id);
CREATE INDEX IF NOT EXISTS idx_symbols_file ON symbol_table(file_path);
CREATE INDEX IF NOT EXISTS idx_imports_file ON import_map(file_path);
CREATE INDEX IF NOT EXISTS idx_imports_source ON import_map(source_path);
`;

export const GRAPH_SCHEMA_VERSION = "1";
