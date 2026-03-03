# How Claude Code UI Integrates with Cursor and Claude

This document describes in detail how the project discovers, connects to, and manages sessions for both **Claude Code** and **Cursor CLI** (as well as Codex and Gemini, which follow similar patterns).

---

## 1. High-Level Architecture

```
┌──────────────────────┐         WebSocket          ┌──────────────────────┐
│   React Frontend     │ ◄────────────────────────► │  Express Backend     │
│   (Vite + React 18)  │                            │  (Node.js)           │
│                      │         REST API            │                      │
│   - ChatInterface    │ ◄────────────────────────► │   /api/projects      │
│   - Sidebar          │                            │   /api/cursor/*      │
│   - Shell (xterm.js) │                            │   /api/codex/*       │
└──────────────────────┘                            └──────────┬───────────┘
                                                               │
                                          ┌────────────────────┼────────────────────┐
                                          │                    │                    │
                                   ┌──────▼──────┐    ┌───────▼───────┐    ┌───────▼───────┐
                                   │ Claude SDK  │    │ cursor-agent  │    │ codex / gemini│
                                   │ (in-process)│    │ (child proc)  │    │ (child proc)  │
                                   └─────────────┘    └───────────────┘    └───────────────┘
```

The UI acts as a single frontend for multiple AI coding agent backends. The key difference between the two main providers:

| Aspect | Claude | Cursor |
|--------|--------|--------|
| **Backend integration** | In-process via `@anthropic-ai/claude-agent-sdk` | Child process via `cursor-agent` CLI |
| **Session storage** | JSONL files in `~/.claude/projects/` | SQLite databases in `~/.cursor/chats/` |
| **Project discovery** | Scan `~/.claude/projects/` directories | Scan `~/.cursor/projects/` directories |
| **Message format** | SDK streaming events (native objects) | Line-delimited JSON from stdout |
| **Session resume** | SDK `resume` option with session ID | `cursor-agent --resume=<id>` flag |
| **Change detection** | chokidar file watcher on `~/.claude/projects/` | Polling loop every 30s checking SQLite blob counts |

---

## 2. Project Discovery

### 2.1 Claude Project Discovery

Claude stores projects in `~/.claude/projects/`. Each subdirectory represents a project, with directory names encoding the project path (e.g., `/home/user/myproject` → `-home-user-myproject`).

**Discovery flow** (in `server/projects.js` → `getClaudeProjects()`):

1. List directories in `~/.claude/projects/`
2. For each directory, extract the actual filesystem path by:
   - Checking `~/.cloudcli/project-config.json` for an `originalPath` entry
   - Parsing JSONL session files for the `cwd` field (most frequent / most recent wins)
   - Falling back to decoding the directory name (`-` → `/`)
3. Generate a display name from `package.json` or the last path component
4. Load the first 5 Claude sessions (paginated)

### 2.2 Cursor Project Discovery

Cursor stores project data in two separate locations:

- **`~/.cursor/projects/{path-encoded}/`** — Agent mode data (config, transcripts, `.workspace-trusted`)
- **`~/.cursor/chats/{md5-hash}/`** — IDE chat sessions (SQLite databases)

**Discovery flow** (in `server/projects.js` → `getCursorProjects()`):

1. List directories in `~/.cursor/projects/` (excluding `tmp-*`)
2. For each directory, extract the actual path by reading `.workspace-trusted`:
   ```json
   { "trustedAt": "2026-01-16T...", "workspacePath": "/home/user/myproject" }
   ```
   Falls back to decoding the directory name if `.workspace-trusted` is missing.
3. Compute `MD5(projectPath)` to locate `~/.cursor/chats/{hash}/`
4. List session subdirectories and read metadata from each `store.db` SQLite file

### 2.3 Project Merging

After discovering projects from all sources, `mergeProjects()` combines them by filesystem path:

- If a project appears in both Claude and Cursor, sessions from both are attached to a single project entry
- Cursor-only projects are flagged with `isCursorOnly: true`
- Manually added projects (via UI) are stored in `~/.cloudcli/project-config.json`

The final project object has arrays for each provider's sessions:
```
{ sessions: [...],          // Claude
  cursorSessions: [...],    // Cursor
  codexSessions: [...],     // Codex
  geminiSessions: [...] }   // Gemini
```

---

## 3. Session Storage Formats

### 3.1 Claude Sessions (JSONL)

Stored as `~/.claude/projects/{encoded-path}/{session-id}.jsonl`. Each line is a JSON object:

```json
{"type":"user","sessionId":"abc123","timestamp":"2026-03-01T...","message":{"role":"user","content":"..."}}
{"type":"assistant","sessionId":"abc123","timestamp":"2026-03-01T...","message":{"role":"assistant","content":[...],"usage":{...}}}
{"type":"summary","sessionId":"abc123","summary":"Implemented dark mode toggle"}
```

Key fields: `sessionId`, `type`, `timestamp`, `message.role`, `message.content`, `cwd`, `uuid`, `parentUuid`.

### 3.2 Cursor Sessions (SQLite)

Stored as `~/.cursor/chats/{md5-hash}/{session-uuid}/store.db`. Each database has:

- **`meta` table**: Key-value pairs with hex-encoded JSON values. Key `"0"` or `"agent"` contains session name, creation time, mode.
- **`blobs` table**: Binary blobs with `id` (SHA-256 hash) and `data`. JSON blobs (starting with `0x7B` = `{`) contain messages. Non-JSON blobs encode parent-child relationships (DAG structure).

The server reconstructs message order by:
1. Building a DAG from parent references in binary blobs
2. Topologically sorting the DAG
3. Matching JSON blob hashes to DAG nodes
4. Sorting JSON blobs by their DAG order (with `rowid` as tiebreaker)

See `getCursorMessagesFromDb()` in `server/routes/cursor.js`.

---

## 4. Real-Time Communication (WebSocket)

### 4.1 WebSocket Architecture

A single `WebSocketServer` handles two paths:
- `/ws` — Chat communication (messages, streaming, permissions)
- `/shell` — Terminal PTY sessions (xterm.js)

### 4.2 Sending Commands

The frontend sends different message types depending on the selected provider:

| Provider | WebSocket `type` | Key Options |
|----------|-----------------|-------------|
| Claude | `claude-command` | `projectPath`, `cwd`, `sessionId`, `toolsSettings`, `permissionMode`, `model`, `images` |
| Cursor | `cursor-command` | `cwd`, `projectPath`, `sessionId`, `resume`, `model`, `skipPermissions`, `toolsSettings` |
| Codex | `codex-command` | Same as Cursor + `permissionMode` |
| Gemini | `gemini-command` | Same as Codex |

### 4.3 Claude Response Flow (SDK)

```
Frontend                    Server (claude-sdk.js)              Claude SDK
   │                              │                                │
   │──claude-command──────────────►│                                │
   │                              │──query({ prompt, options })────►│
   │                              │◄──streaming messages────────────│
   │◄──session-created────────────│  (captures session_id)         │
   │◄──claude-response────────────│  (for each message)            │
   │◄──claude-permission-request──│  (tool use approval)           │
   │──claude-permission-response──►│                                │
   │◄──token-budget───────────────│  (on result message)           │
   │◄──claude-complete────────────│  (stream done)                 │
```

The Claude SDK integration uses `@anthropic-ai/claude-agent-sdk`'s `query()` function, which returns an async iterable of events. Messages are transformed via `transformMessage()` and forwarded as-is.

Tool permissions are handled via `canUseTool` callback:
1. Check if tool is in allowed/disallowed lists
2. If not, send `claude-permission-request` to frontend
3. Wait for `claude-permission-response` from frontend (with timeout)
4. Return allow/deny to the SDK

### 4.4 Cursor Response Flow (CLI)

```
Frontend                    Server (cursor-cli.js)            cursor-agent CLI
   │                              │                                │
   │──cursor-command──────────────►│                                │
   │                              │──spawn('cursor-agent', args)───►│
   │                              │◄──stdout (JSON lines)───────────│
   │◄──session-created────────────│  (from type:"system" init)     │
   │◄──claude-response────────────│  (converts assistant msgs)     │
   │◄──cursor-system──────────────│  (system messages)             │
   │◄──cursor-result──────────────│  (result messages)             │
   │◄──claude-complete────────────│  (process exit)                │
```

Key difference: Cursor spawns a child process (`cursor-agent`) with `--output-format stream-json`. The server parses stdout line by line, converts the JSON events to WebSocket messages that mimic Claude's format for frontend compatibility:

- Cursor `assistant` messages → wrapped as `claude-response` with `content_block_delta` / `text_delta`
- This allows the same `ChatMessagesPane` component to render both Claude and Cursor streams

### 4.5 Abort Flow

Both providers support aborting:
- **Claude**: Calls `queryInstance.interrupt()` on the SDK query object
- **Cursor**: Sends `SIGTERM` to the child process

---

## 5. Frontend Provider Management

### 5.1 Provider Selection (`useChatProviderState`)

State persisted in `localStorage`:

```
selected-provider  → 'claude' | 'cursor' | 'codex' | 'gemini'
cursor-model       → e.g. 'gpt-5.2'
claude-model       → e.g. 'sonnet'
codex-model        → e.g. 'gpt-5.3-codex'
gemini-model       → e.g. 'gemini-2.5-flash'
```

When a session is selected and it has a `__provider` tag, the provider auto-switches to match.

### 5.2 Session Tagging

When sessions from different providers are merged for display, each session gets a `__provider` tag:

```typescript
function getAllSessions(project: Project): ProjectSession[] {
  return [
    ...project.sessions.map(s => ({ ...s, __provider: 'claude' })),
    ...project.cursorSessions.map(s => ({ ...s, __provider: 'cursor' })),
    ...project.codexSessions.map(s => ({ ...s, __provider: 'codex' })),
    ...project.geminiSessions.map(s => ({ ...s, __provider: 'gemini' })),
  ];
}
```

### 5.3 Message Conversion

When loading historical messages from a session, different converters are used:

| Provider | Converter | Source Format |
|----------|-----------|---------------|
| Claude | `convertSessionMessages()` | JSONL entries with `message.role` and `message.content` |
| Cursor | `convertCursorSessionMessages()` | SQLite blob JSON with `role`, `content`, `tool_calls` |
| Codex | `convertSessionMessages()` (with preprocessing) | JSONL with `response_item` events |
| Gemini | `convertSessionMessages()` | Session manager in-memory |

### 5.4 Unread Tracking

Different providers use different mechanisms:

| Provider | Read Marker | Unread Detection |
|----------|-------------|------------------|
| Claude | `readAt` (ISO timestamp) | `lastActivity > readAt` |
| Cursor | `readBlobOffset` (integer) | `lastBlobOffset > readBlobOffset` |
| Codex | `readAt` (ISO timestamp) | `lastActivity > readAt` |
| Gemini | `readAt` (ISO timestamp) | `lastActivity > readAt` |

---

## 6. Shell (PTY) Integration

The shell component provides direct terminal access to any provider's CLI:

```
Frontend (xterm.js)  ←──WebSocket /shell──►  Server  ──PTY──►  bash -c "cd /project && <command>"
```

Commands constructed per provider:

| Provider | Shell Command |
|----------|--------------|
| Claude | `cd "$projectPath" && claude --resume $sessionId` |
| Cursor | `cd "$projectPath" && cursor-agent --resume="$sessionId"` |
| Codex | `cd "$projectPath" && codex resume "$sessionId"` |
| Gemini | `cd "$projectPath" && gemini --resume "$sessionId"` |

PTY sessions are kept alive for 30 minutes after WebSocket disconnect, allowing reconnection with buffered output replay.

---

## 7. Change Detection & Live Updates

### 7.1 Claude / Codex / Gemini (File Watcher)

Uses `chokidar` to watch:
- `~/.claude/projects/` — Claude sessions
- `~/.codex/sessions/` — Codex sessions
- `~/.gemini/projects/` and `~/.gemini/sessions/` — Gemini sessions

On file changes, a debounced (300ms) `sessions_updated` WebSocket message is broadcast to all connected clients with the affected project name and session IDs.

### 7.2 Cursor (Polling)

Cursor's SQLite databases can't be reliably watched with file watchers, so a polling loop runs every 30 seconds:

1. Scan all `~/.cursor/chats/{hash}/{session}/store.db` files
2. Count JSON blobs (`WHERE substr(data, 1, 1) = X'7B'`)
3. Compare with cached counts — if changed, broadcast `sessions_updated`

The mapping from MD5 hash back to project name is built by scanning `~/.cursor/projects/` and reading `.workspace-trusted` files.

---

## 8. Configuration Management

### 8.1 Cursor CLI Config

Read/written at `~/.cursor/cli-config.json`:

```json
{
  "version": 1,
  "model": { "modelId": "gpt-5", "displayName": "GPT-5" },
  "permissions": { "allow": [], "deny": [] }
}
```

Endpoints: `GET /api/cursor/config`, `POST /api/cursor/config`

### 8.2 Claude SDK Config

Claude uses the SDK's built-in configuration:
- Model: Passed via `options.model` (default: `'sonnet'`)
- System prompt: Uses `preset: 'claude_code'` (loads `CLAUDE.md` files)
- Setting sources: `['project', 'user', 'local']`

### 8.3 MCP Servers

Both providers support MCP (Model Context Protocol) servers:

- **Claude**: Loaded from `~/.claude.json` → `mcpServers` (global) and `claudeProjects[cwd].mcpServers` (per-project)
- **Cursor**: Managed at `~/.cursor/mcp.json` via `GET/POST/DELETE /api/cursor/mcp/*`

### 8.4 Tool Permissions

- **Claude**: Full permission system via `canUseTool` callback. The frontend shows approval dialogs and can remember decisions.
- **Cursor**: Simplified — `skipPermissions` flag or `-f` flag on CLI. No interactive permission dialogs.

### 8.5 Session Metadata

Per-session config (starred, read state) is stored in a SQLite database managed by `server/session-config.js`, keyed by `(projectName, sessionId)`. This is separate from the providers' own storage.

---

## 9. Supported Models

Defined in `shared/modelConstants.js` and shared between frontend and backend:

| Provider | Default | Options |
|----------|---------|---------|
| Claude | `sonnet` | sonnet, opus, haiku, opusplan, sonnet[1m] |
| Cursor | `gpt-5` | gpt-5.2-high, gemini-3-pro, opus-4.5-thinking, gpt-5.2, gpt-5.1, composer-1, auto, sonnet-4.5, etc. |
| Codex | `gpt-5.3-codex` | gpt-5.3-codex, gpt-5.2-codex, gpt-5.2, gpt-5.1-codex-max, o3, o4-mini |
| Gemini | `gemini-2.5-flash` | gemini-3.1-pro-preview, gemini-3-pro-preview, gemini-2.5-pro, gemini-2.0-flash, etc. |

---

## 10. Key Files Reference

| File | Purpose |
|------|---------|
| `server/claude-sdk.js` | Claude SDK integration — query, stream, abort, tool permissions |
| `server/cursor-cli.js` | Cursor CLI integration — spawn, parse stdout, abort |
| `server/routes/cursor.js` | REST API for Cursor config, MCP, sessions, messages |
| `server/projects.js` | Project discovery, session listing, merging across providers |
| `server/index.js` | Express server, WebSocket routing, file watchers, Cursor polling |
| `shared/modelConstants.js` | Model definitions shared between frontend and backend |
| `src/contexts/WebSocketContext.tsx` | Frontend WebSocket connection (provider-agnostic) |
| `src/components/chat/hooks/useChatProviderState.ts` | Provider & model selection state |
| `src/components/chat/hooks/useChatComposerState.ts` | Message sending with provider-specific payloads |
| `src/components/chat/hooks/useChatSessionState.ts` | Session loading & message conversion |
| `src/components/sidebar/utils/utils.ts` | Session display utilities, `getAllSessions()` with provider tagging |
| `src/types/app.ts` | TypeScript types: `SessionProvider`, `Project`, `ProjectSession` |
| `src/utils/api.js` | REST API client with provider-specific endpoints |
