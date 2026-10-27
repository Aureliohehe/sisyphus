package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf8"
)

const maxFileBytes = 64 * 1024

type ToolDefinition struct {
	Type     string       `json:"type"`
	Function ToolFunction `json:"function"`
}

type ToolFunction struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	Parameters  map[string]any `json:"parameters"`
}

func toolDefinitions() []ToolDefinition {
	makeTool := func(name, description string, properties map[string]any, required []string) ToolDefinition {
		return ToolDefinition{Type: "function", Function: ToolFunction{
			Name: name, Description: description,
			Parameters: map[string]any{"type": "object", "properties": properties, "required": required, "additionalProperties": false},
		}}
	}
	pathProperty := map[string]string{"type": "string", "description": "工作目录内的相对路径，目录根使用 ."}
	return []ToolDefinition{
		makeTool("list_directory", "列出目录的前 200 个条目，不递归。", map[string]any{"path": pathProperty}, []string{"path"}),
		makeTool("read_file", "读取不超过 64 KiB 的 UTF-8 文本文件；拒绝更大的文件及二进制文件。", map[string]any{"path": pathProperty}, []string{"path"}),
		makeTool("search_text", "递归搜索文本字面量，大小写敏感。跳过符号链接、.git、node_modules 及大文件。最多 50 条匹配，有扫描上限。", map[string]any{
			"path": pathProperty, "query": map[string]string{"type": "string", "description": "要查找的非空文本"},
		}, []string{"path", "query"}),
	}
}

func executeTool(ctx context.Context, root *os.Root, name, arguments string) (string, error) {
	var args struct {
		Path  string `json:"path"`
		Query string `json:"query"`
	}
	decoder := json.NewDecoder(strings.NewReader(arguments))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&args); err != nil {
		return "", fmt.Errorf("工具参数必须是有效的 JSON 对象")
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return "", fmt.Errorf("工具参数包含多余内容")
	}
	if args.Path == "" || !filepath.IsLocal(args.Path) {
		return "", fmt.Errorf("路径必须位于工作目录内，不能使用绝对路径或向上越界")
	}
	if err := ctx.Err(); err != nil {
		return "", err
	}
	switch name {
	case "list_directory":
		info, err := root.Stat(args.Path)
		if err != nil || !info.IsDir() {
			return "", fmt.Errorf("无法访问该目录")
		}
		file, err := root.Open(args.Path)
		if err != nil {
			return "", fmt.Errorf("无法访问该目录")
		}
		defer file.Close()
		entries, err := file.ReadDir(201)
		if err != nil && err != io.EOF {
			return "", fmt.Errorf("无法列出目录")
		}
		truncated := len(entries) > 200
		if truncated {
			entries = entries[:200]
		}
		items := make([]map[string]string, 0, len(entries))
		for _, entry := range entries {
			kind := "file"
			if entry.IsDir() {
				kind = "directory"
			} else if entry.Type()&os.ModeSymlink != 0 {
				kind = "symlink"
			}
			items = append(items, map[string]string{"name": entry.Name(), "type": kind})
		}
		return jsonText(map[string]any{"entries": items, "truncated": truncated}), nil
	case "read_file":
		return readText(root, args.Path)
	case "search_text":
		if strings.TrimSpace(args.Query) == "" || len(args.Query) > 1024 {
			return "", fmt.Errorf("搜索文本必须为 1 到 1024 字节")
		}
		return searchText(ctx, root, args.Path, args.Query)
	default:
		return "", fmt.Errorf("不支持的工具：%s", name)
	}
}

func readText(root *os.Root, path string) (string, error) {
	info, err := root.Stat(path)
	if err != nil || !info.Mode().IsRegular() {
		return "", fmt.Errorf("无法读取该文件，必须是工作目录内的普通文件")
	}
	if info.Size() > maxFileBytes {
		return "", fmt.Errorf("文件超过 64 KiB 限制，请使用更小的文件")
	}
	file, err := root.Open(path)
	if err != nil {
		return "", fmt.Errorf("无法打开该文件")
	}
	defer file.Close()
	info, err = file.Stat()
	if err != nil || !info.Mode().IsRegular() {
		return "", fmt.Errorf("只支持普通文本文件")
	}
	data, err := io.ReadAll(io.LimitReader(file, maxFileBytes+1))
	if err != nil {
		return "", fmt.Errorf("读取文件失败")
	}
	if len(data) > maxFileBytes {
		return "", fmt.Errorf("文件超过 64 KiB 限制")
	}
	if !utf8.Valid(data) || bytes.IndexByte(data, 0) >= 0 {
		return "", fmt.Errorf("只支持 UTF-8 文本，不支持二进制文件")
	}
	return string(data), nil
}

func searchText(ctx context.Context, root *os.Root, path, query string) (string, error) {
	matches := make([]map[string]any, 0)
	visited, totalBytes, skipped := 0, 0, 0
	truncated := false
	stop := errors.New("搜索上限")
	var walk func(string) error
	walk = func(path string) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		visited++
		if visited > 2000 || totalBytes >= 8*1024*1024 {
			truncated = true
			return stop
		}
		info, err := root.Lstat(path)
		if err != nil {
			skipped++
			return nil
		}
		if info.Mode()&fs.ModeSymlink != 0 {
			skipped++
			return nil
		}
		if info.IsDir() {
			if info.Name() == ".git" || info.Name() == "node_modules" {
				skipped++
				return nil
			}
			file, err := root.Open(path)
			if err != nil {
				skipped++
				return nil
			}
			defer file.Close()
			for {
				entries, readErr := file.ReadDir(100)
				for _, entry := range entries {
					if err := walk(filepath.Join(path, entry.Name())); err != nil {
						return err
					}
				}
				if readErr == io.EOF {
					return nil
				}
				if readErr != nil {
					skipped++
					return nil
				}
			}
		}
		text, err := readText(root, path)
		if err != nil {
			skipped++
			return nil
		}
		totalBytes += len(text)
		for index, line := range strings.Split(text, "\n") {
			if strings.Contains(line, query) {
				runes := []rune(line)
				if len(runes) > 300 {
					line = string(runes[:300]) + "…"
				}
				matches = append(matches, map[string]any{"path": filepath.ToSlash(path), "line": index + 1, "text": line})
				if len(matches) >= 50 {
					truncated = true
					return stop
				}
			}
		}
		return nil
	}
	if _, err := root.Stat(path); err != nil {
		return "", fmt.Errorf("无法访问搜索路径")
	}
	if err := walk(path); err != nil && !errors.Is(err, stop) {
		return "", err
	}
	return jsonText(map[string]any{"matches": matches, "truncated": truncated, "skipped": skipped}), nil
}

func jsonText(value any) string {
	data, _ := json.Marshal(value)
	return string(data)
}
