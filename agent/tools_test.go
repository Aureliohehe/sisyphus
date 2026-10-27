package main

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func testRoot(t *testing.T) (*os.Root, string) {
	t.Helper()
	dir := t.TempDir()
	root, err := os.OpenRoot(dir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { root.Close() })
	return root, dir
}

func writeFixture(t *testing.T, path, content string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0600); err != nil {
		t.Fatal(err)
	}
}

func TestReadTools(t *testing.T) {
	root, dir := testRoot(t)
	writeFixture(t, filepath.Join(dir, "note.txt"), "第一行\nhello agent\n")
	ctx := context.Background()
	text, err := executeTool(ctx, root, "read_file", `{"path":"note.txt"}`)
	if err != nil || !strings.Contains(text, "hello agent") {
		t.Fatalf("read: %q %v", text, err)
	}
	listing, err := executeTool(ctx, root, "list_directory", `{"path":"."}`)
	if err != nil || !strings.Contains(listing, "note.txt") {
		t.Fatalf("list: %q %v", listing, err)
	}
	result, err := executeTool(ctx, root, "search_text", `{"path":".","query":"hello"}`)
	if err != nil || !strings.Contains(result, `"line":2`) {
		t.Fatalf("search: %q %v", result, err)
	}
}

func TestToolsRejectUnsafeInput(t *testing.T) {
	root, dir := testRoot(t)
	writeFixture(t, filepath.Join(dir, "binary"), "hello\x00world")
	writeFixture(t, filepath.Join(dir, "large"), strings.Repeat("x", maxFileBytes+1))
	writeFixture(t, filepath.Join(dir, "invalid"), string([]byte{0xff, 0xfe}))
	for _, path := range []string{"../outside", filepath.Join(dir, "binary"), "binary", "large", "invalid", ".", "missing"} {
		t.Run(path, func(t *testing.T) {
			_, err := executeTool(context.Background(), root, "read_file", jsonText(map[string]string{"path": path}))
			if err == nil {
				t.Fatal("expected rejection")
			}
		})
	}
	for _, args := range []string{`{`, `null`, `{}`, `{"path":".","extra":1}`, `{"path":"."} {}`} {
		if _, err := executeTool(context.Background(), root, "list_directory", args); err == nil {
			t.Fatalf("accepted invalid arguments %s", args)
		}
	}
	if _, err := executeTool(context.Background(), root, "shell", `{"path":"."}`); err == nil {
		t.Fatal("accepted unknown tool")
	}
}

func TestToolsRejectSymlinkEscape(t *testing.T) {
	root, dir := testRoot(t)
	outside := t.TempDir()
	writeFixture(t, filepath.Join(outside, "secret.txt"), "secret")
	if err := os.Symlink(outside, filepath.Join(dir, "escape")); err != nil {
		t.Skip(err)
	}
	for _, tool := range []string{"read_file", "list_directory", "search_text"} {
		path := "escape"
		if tool == "read_file" {
			path += "/secret.txt"
		}
		_, err := executeTool(context.Background(), root, tool, jsonText(map[string]string{"path": path, "query": "secret"}))
		if err == nil {
			t.Fatalf("%s escaped workspace", tool)
		}
	}
	result, err := executeTool(context.Background(), root, "search_text", `{"path":".","query":"secret"}`)
	if err != nil || strings.Contains(result, "secret.txt") {
		t.Fatalf("search followed symlink: %s %v", result, err)
	}
}

func TestSearchLimitsAndCancellation(t *testing.T) {
	root, dir := testRoot(t)
	writeFixture(t, filepath.Join(dir, "many.txt"), strings.Repeat("needle\n", 80))
	if err := os.Mkdir(filepath.Join(dir, "node_modules"), 0700); err != nil {
		t.Fatal(err)
	}
	writeFixture(t, filepath.Join(dir, "node_modules", "hidden.txt"), "hidden")
	result, err := executeTool(context.Background(), root, "search_text", `{"path":".","query":"needle"}`)
	var parsed struct {
		Matches   []any `json:"matches"`
		Truncated bool  `json:"truncated"`
	}
	if err != nil || json.Unmarshal([]byte(result), &parsed) != nil || len(parsed.Matches) != 50 || !parsed.Truncated {
		t.Fatalf("limit: %s %v", result, err)
	}
	result, err = executeTool(context.Background(), root, "search_text", `{"path":".","query":"hidden"}`)
	if err != nil || strings.Contains(result, "hidden.txt") {
		t.Fatalf("dependency scan: %s %v", result, err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := executeTool(ctx, root, "search_text", `{"path":".","query":"x"}`); err != context.Canceled {
		t.Fatalf("cancellation: %v", err)
	}
}
