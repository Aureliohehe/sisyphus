package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestProtocolCancelAndReuse(t *testing.T) {
	started := make(chan struct{}, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		io.Copy(io.Discard, r.Body)
		started <- struct{}{}
		<-r.Context().Done()
	}))
	defer server.Close()
	inputReader, inputWriter := io.Pipe()
	outputReader, outputWriter := io.Pipe()
	defer inputWriter.Close()
	defer outputReader.Close()
	exited := make(chan error, 1)
	go func() {
		exited <- serve(inputReader, outputWriter)
		outputWriter.Close()
	}()
	events := make(chan Event, 16)
	go func() {
		defer close(events)
		decoder := json.NewDecoder(outputReader)
		for {
			var event Event
			if decoder.Decode(&event) != nil {
				return
			}
			events <- event
		}
	}()
	next := func() Event {
		t.Helper()
		select {
		case event := <-events:
			return event
		case <-time.After(5 * time.Second):
			t.Fatal("event timeout")
			return Event{}
		}
	}
	encoder := json.NewEncoder(inputWriter)
	inputWriter.Write([]byte("invalid\n"))
	if event := next(); event.Type != "error" {
		t.Fatalf("invalid input: %+v", event)
	}
	command := testCommand(server.URL)
	encoder.Encode(command)
	select {
	case <-started:
	case <-time.After(5 * time.Second):
		t.Fatal("provider did not start")
	}
	busy := command
	busy.RequestID = "busy"
	encoder.Encode(busy)
	if event := next(); event.Type != "error" || event.RequestID != "busy" {
		t.Fatalf("busy: %+v", event)
	}
	encoder.Encode(Command{Type: "cancel", RequestID: command.RequestID})
	if event := next(); event.Type != "done" || !event.Cancelled || event.RequestID != command.RequestID {
		t.Fatalf("cancel: %+v", event)
	}
	fast := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mockResponse(w, Message{Role: "assistant", Content: "再次运行"})
	}))
	defer fast.Close()
	command = testCommand(fast.URL)
	command.RequestID = "reuse"
	encoder.Encode(command)
	if event := next(); event.Type != "text_delta" || event.RequestID != "reuse" {
		t.Fatalf("reuse text: %+v", event)
	}
	if event := next(); event.Type != "done" || event.Cancelled {
		t.Fatalf("reuse done: %+v", event)
	}
	inputWriter.Close()
	select {
	case err := <-exited:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("runtime did not exit on EOF")
	}
}
