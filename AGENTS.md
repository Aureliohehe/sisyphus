# AGENTS.md — Sisyphus AI Client

Electron 30 + React 18 + TypeScript + Zustand + TailwindCSS desktop AI agent app, with a Go 1.24+ runtime.

## Commands

```bash
npm run dev          # Build Go runtime, start electron-vite dev
npm run build        # Build Go runtime and Electron app
npm run package      # Build, then package with electron-builder
npm run test:agent   # Go unit/protocol tests with race detector
npm run typecheck    # Check both TypeScript projects
```

Go tests use local mock providers; no frontend test runner or linter configured. Go runtime uses only the standard library. See `agent/README.md` for protocol, limits, and cross-platform packaging.

## Architecture: Electron + Go Subprocess

- **Go runtime** (`agent/`): Model requests, read-only file tools, max 10-round agent loop, cancellation and timeout
- **Main process** (`src/main/`): Node.js — IPC handlers, file dialogs, Go process lifecycle; legacy `ai:chat` and model-list API calls
- **Preload** (`src/preload/`): `@electron-toolkit/preload` — `contextBridge.exposeInMainWorld('api', {...})` exposes safe IPC methods to renderer
- **Renderer** (`src/renderer/`): React app — all UI lives here

**Critical**: Go, main process and preload changes require a full app restart. `npm run dev` hot-reloads the renderer only. `scripts/build-agent.mjs` builds to `build/agent/`; electron-builder copies the binary into `resources/agent/`.

## IPC Bridge

| Channel | Direction | Purpose |
|---------|-----------|---------|
| `ai:chat` | renderer→main | Single-shot AI response |
| `ai:chatStream` | renderer→main→Go | Start task with config, messages, requestId |
| `agent:event` | Go→main→renderer | text_delta, tool_start, tool_end, done, error |
| `agent:getWorkspace` / `agent:selectWorkspace` / `agent:clearWorkspace` | renderer→main | Native workspace authorization, window-scoped and not persisted |
| `agent:cancel` | renderer→main→Go | Cancel task by requestId, owner checked |
| `ai:listModels` | renderer→main | Fetch available models from provider API |
| `select-avatar` | renderer→main | Native file dialog for avatar image |
| `select-files` | renderer→main | Native multi-file dialog, returns `{name, content, size}[]` |

Renderer calls: `window.api.selectAvatar()`, `window.api.selectFiles()`, `window.api.listModels(baseURL, apiKey)`

Task transport: `src/renderer/services/ai-client.ts` invokes `ai:chatStream` and subscribes via `window.api.onAgentEvent`. Only one task can run at a time; events are filtered by requestId. `clearAgentListeners()` removes listeners on terminal events and invoke failures. First version uses non-streaming model requests: text_delta carries the complete final answer, not individual tokens.

## State Management (Zustand)

| Store | Responsibility | Persisted? |
|-------|---------------|------------|
| `appStore` | View routing, provider/model selection, API configs, theme, user profile | Config/profile yes |
| `chatStore` | Transient response state (`isLoading`, `streamContent`) | No |
| `agentStore` | Workspace, requestId, tool status | No |
| `conversationStore` | Conversations, messages, active selection | Yes (localStorage) |

**Key pattern**: `conversationStore` owns all message data. `chatStore` is ephemeral streaming buffer only. On stream complete, `flushStream()` returns content and `addMessage()` saves it to `conversationStore`.

## View Routing

AppLayout renders one view based on `appStore.currentView`:
- `'home'` → HomeWorkspace (InputBox + QuickPrompts)
- `'chat'` → ChatView (message list + ChatInput)
- `'settings'` → SettingsView
- `'account'` → AccountView

## Models: Display Name vs API ID

`ModelOption { name: string, id: string }` — `name` is Chinese display label, `id` is the API model identifier. E.g. `{ name: "DeepSeek V4 Flash", id: "deepseek-chat" }`.

## AI Request Flow

1. Renderer builds `AIConfig` from `appStore.getCurrentConfig()` (provider, model, apiKey, baseURL)
2. Renderer builds message array from `conversationStore.getActiveMessages()`
3. Calls `sendChatMessageStream(config, messages, callbacks)` in `ai-client.ts`
4. Main process sends JSON Lines to the Go subprocess; workspace is taken from native authorization, never from model arguments
5. Go calls the model and executes list_directory/read_file/search_text within os.OpenRoot, forwarding tool status and the final answer
6. Renderer's `onChunk` appends to `chatStore.streamContent`, `onDone` flushes to the originating conversation via `addMessage(message, conversationId)`

No workspace means ordinary chat without tools. File content may be sent to the configured provider. Do not add write/Shell tools without explicit approval UX. API keys travel over stdin, not command arguments or logs. Total timeout is 3 minutes; Electron has a 190-second watchdog and kills the process after 2 seconds if cancellation does not finish.

## Conventions

- All UI text is **Chinese** (简体中文)
- Dark theme only — custom colors defined in `tailwind.config.js` (`surface`, `muted`, etc.)
- Icons: use `lucide-react`, not emoji
- Path alias: `@/` → `src/renderer/` (configured in `electron.vite.config.ts` and `tsconfig.web.json`)
- No code comments unless explicitly requested
- User preferences: theme stays as dropdown (not toggle), logout icon in red
- Custom Tailwind classes: `input-glow`, `glass-panel`, `.sidebar-item`, `.prompt-chip`

## File Attachments

The "+" / paperclip button opens a native file dialog via `select-files` IPC. Selected text files are embedded into the message content with `[文件: filename]\ncontent` markers. Only UTF-8 text files are supported.

## Conversation Sidebar

Each conversation item shows a hover-revealed X button (lucide `X` icon) using `group`/`opacity-0 group-hover:opacity-100` pattern. Clicking X calls `conversationStore.deleteConversation()` which auto-switches active conversation.