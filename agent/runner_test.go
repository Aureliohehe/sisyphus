package main

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func mockResponse(w http.ResponseWriter, message Message) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"message": message, "finish_reason": "stop"}}})
}

func readCall() ToolCall {
	var call ToolCall
	call.ID, call.Type = "call-1", "function"
	call.Function.Name, call.Function.Arguments = "read_file", `{"path":"note.txt"}`
	return call
}

func testCommand(url string) Command {
	return Command{Type: "run", RequestID: "test-1", Config: Config{BaseURL: url, Model: "test", APIKey: "test-key"}, Messages: []Message{{Role: "user", Content: "读取笔记"}}}
}

func TestAgentToolLoop(t *testing.T) {
	_, dir := testRoot(t)
	writeFixture(t, filepath.Join(dir, "note.txt"), "来自文件的内容")
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/chat/completions" || r.Header.Get("Authorization") != "Bearer test-key" {
			t.Error("invalid provider request")
		}
		var body struct {
			Messages []Message        `json:"messages"`
			Tools    []ToolDefinition `json:"tools"`
			Stream   bool             `json:"stream"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		if len(body.Tools) != 3 || body.Stream {
			t.Error("expected three tools and non-streaming MVP")
		}
		if calls.Add(1) == 1 {
			mockResponse(w, Message{Role: "assistant", ToolCalls: []ToolCall{readCall()}, ReasoningContent: "thinking"})
			return
		}
		last := body.Messages[len(body.Messages)-1]
		if last.Role != "tool" || last.ToolCallID != "call-1" || last.Content != "来自文件的内容" {
			t.Errorf("invalid tool response: %+v", last)
		}
		if body.Messages[len(body.Messages)-2].ReasoningContent != "thinking" {
			t.Error("reasoning content was lost")
		}
		mockResponse(w, Message{Role: "assistant", Content: "这是总结"})
	}))
	defer server.Close()
	command := testCommand(server.URL)
	command.Workspace = dir
	var events []Event
	if err := runAgent(context.Background(), command, func(event Event) { events = append(events, event) }); err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 2 || len(events) != 3 || events[0].Type != "tool_start" || events[1].Type != "tool_end" || events[2].Text != "这是总结" {
		t.Fatalf("unexpected events: %+v", events)
	}
}

func TestAgentRoundLimit(t *testing.T) {
	_, dir := testRoot(t)
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		mockResponse(w, Message{Role: "assistant", ToolCalls: []ToolCall{readCall()}})
	}))
	defer server.Close()
	command := testCommand(server.URL)
	command.Workspace = dir
	failures := 0
	err := runAgent(context.Background(), command, func(event Event) {
		if event.Type == "tool_end" && event.Error != "" {
			failures++
		}
	})
	if err == nil || !strings.Contains(err.Error(), "10") || calls.Load() != 10 || failures != 10 {
		t.Fatalf("limit/error recovery: calls=%d failures=%d err=%v", calls.Load(), failures, err)
	}
}

func TestPlainChatHasNoTools(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]json.RawMessage
		json.NewDecoder(r.Body).Decode(&body)
		if _, exists := body["tools"]; exists {
			t.Error("tools exposed without workspace consent")
		}
		mockResponse(w, Message{Role: "assistant", Content: "你好"})
	}))
	defer server.Close()
	if err := runAgent(context.Background(), testCommand(server.URL), func(Event) {}); err != nil {
		t.Fatal(err)
	}
}

func TestProviderErrors(t *testing.T) {
	for _, test := range []struct {
		name string
		code int
		body string
	}{
		{"auth", 401, "secret error details"},
		{"invalid", 200, "not json"},
		{"empty", 200, `{"choices":[]}`},
		{"truncated", 200, `{"choices":[{"message":{"role":"assistant","content":"partial"},"finish_reason":"length"}]}`},
	} {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(test.code)
				w.Write([]byte(test.body))
			}))
			defer server.Close()
			err := runAgent(context.Background(), testCommand(server.URL), func(Event) {})
			if err == nil || strings.Contains(err.Error(), "secret") {
				t.Fatalf("unsafe or missing error: %v", err)
			}
		})
	}
}

func TestProviderDeadline(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		io.Copy(io.Discard, r.Body)
		<-r.Context().Done()
	}))
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
	defer cancel()
	if err := runAgent(ctx, testCommand(server.URL), func(Event) {}); err != context.DeadlineExceeded {
		t.Fatalf("deadline: %v", err)
	}
}
