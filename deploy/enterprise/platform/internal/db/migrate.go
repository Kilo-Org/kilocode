package db

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

func Migrate(conn *sql.DB, dir string) error {
	_, err := conn.Exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
  version BIGINT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`)
	if err != nil {
		return fmt.Errorf("ensure schema_migrations: %w", err)
	}

	entries, err := os.ReadDir(dir)
	if err != nil {
		return fmt.Errorf("read migrations: %w", err)
	}

	var files []string
	for _, entry := range entries {
		name := entry.Name()
		if entry.IsDir() || !strings.HasSuffix(name, ".up.sql") {
			continue
		}
		files = append(files, name)
	}
	sort.Strings(files)

	for _, name := range files {
		ver, err := version(name)
		if err != nil {
			return err
		}
		var done bool
		err = conn.QueryRow(`SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version = $1)`, ver).Scan(&done)
		if err != nil {
			return fmt.Errorf("check migration %d: %w", ver, err)
		}
		if done {
			continue
		}
		body, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil {
			return fmt.Errorf("read %s: %w", name, err)
		}
		if _, err := conn.Exec(string(body)); err != nil {
			return fmt.Errorf("apply %s: %w", name, err)
		}
		if _, err := conn.Exec(`INSERT INTO schema_migrations (version) VALUES ($1)`, ver); err != nil {
			return fmt.Errorf("record %s: %w", name, err)
		}
	}
	return nil
}

func version(name string) (int64, error) {
	prefix := strings.SplitN(name, "_", 2)[0]
	ver, err := strconv.ParseInt(prefix, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("migration version in %s: %w", name, err)
	}
	return ver, nil
}
