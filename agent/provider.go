package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type Config struct {
	APIKey  string `json:"apiKey"`
	BaseURL string `json:"baseURL"`
	Model   string `json:"model"`
}

type ToolCall struct {
	ID       string `json:"id"`
	Type     string `json:"type"`
	Function struct {
		Name      string `json:"name"`
		Arguments string `json:"arguments"`
	} `json:"function"`
}

type Message struct {
	Role             string     `json:"role"`
	Content          string     `json:"content"`
	ToolCalls        []ToolCall `json:"tool_calls,omitempty"`
	ToolCallID       string     `json:"tool_call_id,omitempty"`
	ReasoningContent string     `json:"reasoning_content,omitempty"`
}

func complete(ctx context.Context, config Config, messages []Message, tools []ToolDefinition) (Message, error) {
	endpoint, err := url.Parse(strings.TrimRight(config.BaseURL, "/") + "/chat/completions")
	if err != nil || endpoint.Host == "" || (endpoint.Scheme != "https" && endpoint.Scheme != "http") || endpoint.User != nil {
		return Message{}, fmt.Errorf("模型接口地址无效")
	}
	body, err := json.Marshal(struct {
		Model    string           `json:"model"`
		Messages []Message        `json:"messages"`
		Tools    []ToolDefinition `json:"tools,omitempty"`
		Stream   bool             `json:"stream"`
	}{Model: config.Model, Messages: messages, Tools: tools})
	if err != nil {
		return Message{}, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint.String(), bytes.NewReader(body))
	if err != nil {
		return Message{}, fmt.Errorf("无法创建模型请求")
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", "Bearer "+config.APIKey)
	client := &http.Client{
		Timeout: 90 * time.Second,
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	response, err := client.Do(request)
	if err != nil {
		if ctx.Err() != nil {
			return Message{}, ctx.Err()
		}
		return Message{}, fmt.Errorf("模型请求失败，请检查接口地址、网络或超时设置")
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return Message{}, fmt.Errorf("模型接口返回 HTTP %d，请检查密钥、模型及工具调用支持", response.StatusCode)
	}
	const maxResponse = 2 * 1024 * 1024
	data, err := io.ReadAll(io.LimitReader(response.Body, maxResponse+1))
	if err != nil {
		return Message{}, fmt.Errorf("无法读取模型响应")
	}
	if len(data) > maxResponse {
		return Message{}, fmt.Errorf("模型响应超过 2 MiB 限制")
	}
	var result struct {
		Choices []struct {
			Message      Message `json:"message"`
			FinishReason string  `json:"finish_reason"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(data, &result); err != nil || len(result.Choices) == 0 {
		return Message{}, fmt.Errorf("模型返回了无效的响应")
	}
	choice := result.Choices[0]
	if choice.FinishReason == "length" || choice.FinishReason == "content_filter" {
		return Message{}, fmt.Errorf("模型响应被截断或过滤，请缩小任务范围")
	}
	if choice.Message.Role != "assistant" {
		return Message{}, fmt.Errorf("模型响应角色无效")
	}
	return choice.Message, nil
}
