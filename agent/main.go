package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"sync"
	"time"
)

type Command struct {
	Type      string    `json:"type"`
	RequestID string    `json:"requestId"`
	Config    Config    `json:"config"`
	Messages  []Message `json:"messages"`
	Workspace string    `json:"workspace"`
}

type Event struct {
	Type      string `json:"type"`
	RequestID string `json:"requestId"`
	Text      string `json:"text,omitempty"`
	Tool      string `json:"tool,omitempty"`
	CallID    string `json:"callId,omitempty"`
	Error     string `json:"error,omitempty"`
	Cancelled bool   `json:"cancelled,omitempty"`
}

type task struct {
	id     string
	cancel context.CancelFunc
}

func serve(input io.Reader, output io.Writer) error {
	var outputMu, taskMu sync.Mutex
	var active *task
	var workers sync.WaitGroup
	encoder := json.NewEncoder(output)
	emit := func(event Event) {
		outputMu.Lock()
		defer outputMu.Unlock()
		if err := encoder.Encode(event); err != nil {
			fmt.Fprintln(os.Stderr, "无法写入运行时事件")
		}
	}
	defer func() {
		taskMu.Lock()
		if active != nil {
			active.cancel()
		}
		taskMu.Unlock()
		workers.Wait()
	}()

	scanner := bufio.NewScanner(input)
	scanner.Buffer(make([]byte, 4096), 8*1024*1024)
	for scanner.Scan() {
		var command Command
		if err := json.Unmarshal(scanner.Bytes(), &command); err != nil {
			emit(Event{Type: "error", Error: "无效的 JSON 请求"})
			continue
		}
		if command.RequestID == "" || len(command.RequestID) > 128 {
			emit(Event{Type: "error", Error: "请求 ID 无效"})
			continue
		}
		switch command.Type {
		case "cancel":
			taskMu.Lock()
			if active != nil && active.id == command.RequestID {
				active.cancel()
			}
			taskMu.Unlock()
		case "run":
			taskMu.Lock()
			if active != nil {
				taskMu.Unlock()
				emit(Event{Type: "error", RequestID: command.RequestID, Error: "已有任务正在运行"})
				continue
			}
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
			active = &task{id: command.RequestID, cancel: cancel}
			taskMu.Unlock()
			workers.Add(1)
			go func(command Command) {
				defer workers.Done()
				defer cancel()
				err := runAgent(ctx, command, func(event Event) {
					event.RequestID = command.RequestID
					emit(event)
				})
				terminal := Event{Type: "done", RequestID: command.RequestID}
				if errors.Is(ctx.Err(), context.Canceled) {
					terminal.Cancelled = true
				} else if errors.Is(ctx.Err(), context.DeadlineExceeded) {
					terminal.Type, terminal.Error = "error", "任务超过 3 分钟，已停止"
				} else if err != nil {
					terminal.Type, terminal.Error = "error", err.Error()
				}
				taskMu.Lock()
				active = nil
				emit(terminal)
				taskMu.Unlock()
			}(command)
		default:
			emit(Event{Type: "error", RequestID: command.RequestID, Error: "未知的请求类型"})
		}
	}
	return scanner.Err()
}

func main() {
	if err := serve(os.Stdin, os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, "运行时输入错误：", err)
		os.Exit(1)
	}
}
