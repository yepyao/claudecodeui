# Cursor API & CLI Interaction Reference

This document provides a comprehensive reference for all Cursor-related REST APIs, WebSocket commands, CLI invocation details, and data formats used by Claude Code UI.

---

## Table of Contents

1. [CLI Invocation (`cursor-agent`)](#1-cli-invocation-cursor-agent)
2. [WebSocket Commands (Real-Time Chat)](#2-websocket-commands-real-time-chat)
3. [WebSocket Events (Server → Frontend)](#3-websocket-events-server--frontend)
4. [REST API Endpoints (`/api/cursor/*`)](#4-rest-api-endpoints-apicursor)
5. [Session Discovery & Project Resolution](#5-session-discovery--project-resolution)
6. [SQLite Message Extraction (store.db)](#6-sqlite-message-extraction-storedb)
7. [Message Conversion (SQLite → ChatMessage)](#7-message-conversion-sqlite--chatmessage)
8. [Change Detection (Polling Loop)](#8-change-detection-polling-loop)
9. [Shell (PTY) Integration](#9-shell-pty-integration)
10. [Data Structures & Types](#10-data-structures--types)

---

## 1. CLI Invocation (`cursor-agent`)

The backend spawns `cursor-agent` as a child process. This happens in `server/cursor-cli.js`.

### 1.1 Command Construction

```
cursor-agent [--resume=<sessionId>] [-p <prompt>] [--model <model>] [--output-format stream-json] [-f]
```

The arguments are built conditionally:

| Condition | Args Added |
|-----------|-----------|
| Resuming a session (`sessionId` present) | `--resume=<sessionId>` |
| User typed a message (`command` non-empty) | `-p <command>` |
| New session with model selection | `--model <model>` |
| Prompt provided (new or resume+reply) | `--output-format stream-json` |
| `skipPermissions` enabled in tools settings | `-f` |

The `--output-format stream-json` flag is only added when a prompt is provided, causing `cursor-agent` to emit line-delimited JSON to stdout.

### 1.2 Process Spawning

```javascript
const cursorProcess = spawn('cursor-agent', args, {
  cwd: workingDir,           // project directory (options.cwd or options.projectPath)
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env }   // inherits all environment variables
});
cursorProcess.stdin.end();   // stdin closed immediately — no interactive input
```

- Uses `cross-spawn` on Windows for better command resolution.
- The process is tracked in `activeCursorProcesses` Map keyed by session ID.
- On Windows, `cursor-agent` must be on PATH or resolvable by `cross-spawn`.

### 1.3 Process Lifecycle

```
spawn cursor-agent
     │
     ├── stdout line → parse JSON → send WebSocket events
     ├── stderr line → send cursor-error event
     │
     └── close(exitCode)
           ├── remove from activeCursorProcesses
           └── send claude-complete event
```

### 1.4 Abort

```javascript
function abortCursorSession(sessionId) {
  const process = activeCursorProcesses.get(sessionId);
  process.kill('SIGTERM');
  activeCursorProcesses.delete(sessionId);
}
```

---

## 2. WebSocket Commands (Real-Time Chat)

Messages sent from the **frontend → server** over the `/ws` WebSocket.

### 2.1 `cursor-command` — Send a Message or Resume

This is the primary command for interacting with Cursor.

```json
{
  "type": "cursor-command",
  "command": "Refactor the auth module",
  "options": {
    "sessionId": "abc-123-def",
    "cwd": "/home/user/myproject",
    "projectPath": "/home/user/myproject",
    "resume": true,
    "model": "gpt-5.2",
    "skipPermissions": false,
    "toolsSettings": {
      "allowedShellCommands": [],
      "skipPermissions": false
    }
  }
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `command` | No | User prompt text. Empty string for resume-only. |
| `options.sessionId` | No | If present, resumes this session. If absent, creates a new session. |
| `options.cwd` | Yes | Working directory for the `cursor-agent` process. |
| `options.projectPath` | No | Fallback for `cwd`. |
| `options.resume` | No | Boolean hint (actual behavior driven by `sessionId` presence). |
| `options.model` | No | Model to use for new sessions (e.g., `gpt-5.2`, `sonnet-4.5`). Ignored on resume. |
| `options.skipPermissions` | No | If true, adds `-f` flag. |
| `options.toolsSettings` | No | Tools settings object from localStorage `cursor-tools-settings`. |

### 2.2 `cursor-resume` — Resume Session (Legacy)

Backward-compatible shorthand. Internally converted to `cursor-command`.

```json
{
  "type": "cursor-resume",
  "sessionId": "abc-123-def",
  "options": { "cwd": "/home/user/myproject" }
}
```

### 2.3 `cursor-abort` — Abort Active Session (Legacy)

```json
{
  "type": "cursor-abort",
  "sessionId": "abc-123-def"
}
```

### 2.4 `abort-session` — Abort Active Session (Unified)

The unified abort command used by all providers.

```json
{
  "type": "abort-session",
  "sessionId": "abc-123-def",
  "provider": "cursor"
}
```

### 2.5 `check-session-status` — Check if Session is Processing

```json
{
  "type": "check-session-status",
  "sessionId": "abc-123-def",
  "provider": "cursor"
}
```

---

## 3. WebSocket Events (Server → Frontend)

Events sent from **server → frontend** during a Cursor session.

### 3.1 `session-created`

Sent once when a new session is created (not on resume).

```json
{
  "type": "session-created",
  "sessionId": "abc-123-def",
  "model": "gpt-5.2",
  "cwd": "/home/user/myproject"
}
```

### 3.2 `cursor-system`

System initialization info from `cursor-agent`. Emitted when the CLI outputs a `type: "system"` message with `subtype: "init"`.

```json
{
  "type": "cursor-system",
  "data": {
    "type": "system",
    "subtype": "init",
    "session_id": "abc-123-def",
    "model": "gpt-5.2",
    "cwd": "/home/user/myproject"
  },
  "sessionId": "abc-123-def"
}
```

### 3.3 `claude-response`

Assistant message chunks, converted to Claude-compatible format for unified frontend rendering.

**Text chunk:**
```json
{
  "type": "claude-response",
  "data": {
    "type": "content_block_delta",
    "delta": {
      "type": "text_delta",
      "text": "Here is the refactored code..."
    }
  },
  "sessionId": "abc-123-def"
}
```

**End of block:**
```json
{
  "type": "claude-response",
  "data": { "type": "content_block_stop" },
  "sessionId": "abc-123-def"
}
```

This format conversion is intentional — by wrapping Cursor output in Claude's `content_block_delta` / `text_delta` structure, the frontend's streaming message handler (`useChatRealtimeHandlers`) can process both providers with the same rendering logic.

### 3.4 `cursor-user`

Echoed user messages from the CLI output.

```json
{
  "type": "cursor-user",
  "data": { "type": "user", "message": { "content": "..." } },
  "sessionId": "abc-123-def"
}
```

### 3.5 `cursor-result`

Final result when `cursor-agent` reports completion.

```json
{
  "type": "cursor-result",
  "sessionId": "abc-123-def",
  "data": { "type": "result", "subtype": "success" },
  "success": true
}
```

### 3.6 `cursor-response`

Generic passthrough for any unrecognized message types from `cursor-agent`.

```json
{
  "type": "cursor-response",
  "data": { "type": "unknown_type", "..." : "..." },
  "sessionId": "abc-123-def"
}
```

### 3.7 `cursor-output`

Raw non-JSON text from `cursor-agent` stdout.

```json
{
  "type": "cursor-output",
  "data": "Some plain text output...",
  "sessionId": "abc-123-def"
}
```

### 3.8 `cursor-error`

Error output from `cursor-agent` stderr or process errors.

```json
{
  "type": "cursor-error",
  "error": "Error message text",
  "sessionId": "abc-123-def"
}
```

### 3.9 `claude-complete`

Sent when the `cursor-agent` process exits. Uses the same event name as Claude for frontend compatibility.

```json
{
  "type": "claude-complete",
  "sessionId": "abc-123-def",
  "exitCode": 0,
  "isNewSession": true
}
```

### 3.10 `session-aborted`

Response to an abort command.

```json
{
  "type": "session-aborted",
  "sessionId": "abc-123-def",
  "provider": "cursor",
  "success": true
}
```

### 3.11 `session-status`

Response to a `check-session-status` command.

```json
{
  "type": "session-status",
  "sessionId": "abc-123-def",
  "provider": "cursor",
  "isProcessing": false
}
```

### 3.12 `sessions_updated`

Broadcast to all connected clients when the polling loop detects changed Cursor sessions.

```json
{
  "type": "sessions_updated",
  "updates": {
    "-home-user-myproject": {
      "sessionIds": ["abc-123-def", "ghi-456-jkl"],
      "provider": "cursor"
    }
  },
  "timestamp": "2026-03-01T12:00:00.000Z",
  "watchProvider": "cursor"
}
```

---

## 4. REST API Endpoints (`/api/cursor/*`)

All endpoints are mounted at `/api/cursor` and require authentication (`authenticateToken` middleware).

### 4.1 Configuration

#### `GET /api/cursor/config`

Read `~/.cursor/cli-config.json`.

**Response:**
```json
{
  "success": true,
  "config": {
    "version": 1,
    "model": { "modelId": "gpt-5", "displayName": "GPT-5" },
    "permissions": { "allow": [], "deny": [] }
  },
  "path": "/home/user/.cursor/cli-config.json",
  "isDefault": false
}
```

Returns a default config if file doesn't exist (with `isDefault: true`).

#### `POST /api/cursor/config`

Update `~/.cursor/cli-config.json`.

**Request body:**
```json
{
  "model": { "modelId": "gpt-5.2", "displayName": "GPT-5.2" },
  "permissions": { "allow": ["read_file"], "deny": [] }
}
```

Both `model` and `permissions` are optional — only provided fields are updated.

### 4.2 MCP Server Management

#### `GET /api/cursor/mcp`

Read MCP servers from `~/.cursor/mcp.json`.

**Response:**
```json
{
  "success": true,
  "servers": [
    {
      "id": "my-server",
      "name": "my-server",
      "type": "stdio",
      "scope": "cursor",
      "config": {
        "command": "node",
        "args": ["server.js"],
        "env": {}
      },
      "raw": { "command": "node", "args": ["server.js"] }
    }
  ],
  "path": "/home/user/.cursor/mcp.json"
}
```

#### `POST /api/cursor/mcp/add`

Add an MCP server using structured fields.

**Request body:**
```json
{
  "name": "my-server",
  "type": "stdio",
  "command": "node",
  "args": ["server.js"],
  "env": { "API_KEY": "..." }
}
```

For HTTP/SSE servers:
```json
{
  "name": "remote-server",
  "type": "http",
  "url": "https://example.com/mcp",
  "headers": { "Authorization": "Bearer ..." }
}
```

#### `POST /api/cursor/mcp/add-json`

Add an MCP server using raw JSON config (bypass the structured form).

**Request body:**
```json
{
  "name": "my-server",
  "jsonConfig": { "command": "node", "args": ["server.js"] }
}
```

`jsonConfig` can be a string (parsed as JSON) or an object.

#### `DELETE /api/cursor/mcp/:name`

Remove an MCP server by name.

**Response:**
```json
{
  "success": true,
  "message": "MCP server \"my-server\" removed from Cursor configuration",
  "config": { "mcpServers": {} }
}
```

### 4.3 Sessions

#### `GET /api/cursor/sessions?projectPath=<path>`

List all sessions for a project. The project path is MD5-hashed to locate `~/.cursor/chats/{hash}/`.

**Response:**
```json
{
  "success": true,
  "sessions": [
    {
      "id": "abc-123-def",
      "name": "Refactor auth module",
      "createdAt": "2026-03-01T10:00:00.000Z",
      "mode": "agent",
      "projectPath": "/home/user/myproject",
      "lastMessage": "Here's the refactored auth...",
      "messageCount": 42,
      "lastBlobOffset": 42,
      "agentId": "...",
      "latestRootBlobId": "..."
    }
  ],
  "cwdId": "d5e0f8c05ed899b2e2a24ceea9acdf31",
  "path": "/home/user/.cursor/chats/d5e0f8c05ed899b2e2a24ceea9acdf31"
}
```

How session metadata is extracted from each `store.db`:

1. Read `meta` table rows
2. Decode hex-encoded JSON values (meta key `"agent"` contains name, createdAt, mode)
3. Count JSON blobs (`WHERE substr(data, 1, 1) = X'7B'`) for `messageCount`
4. Read last JSON blob's content for `lastMessage` preview (first 100 chars)
5. Fall back to `store.db` file mtime for `createdAt` if not in metadata

#### `GET /api/cursor/sessions/:sessionId?projectPath=<path>`

Get a specific session with all messages (full session, no pagination).

**Response:**
```json
{
  "success": true,
  "session": {
    "id": "abc-123-def",
    "projectPath": "/home/user/myproject",
    "messages": [
      {
        "id": "sha256hex",
        "sequence": 1,
        "rowid": 5,
        "content": { "role": "user", "content": [{ "type": "text", "text": "..." }] }
      }
    ],
    "metadata": { "agent": { "name": "...", "createdAt": 1709290000000 } },
    "cwdId": "d5e0f8c05ed899b2e2a24ceea9acdf31"
  }
}
```

#### `GET /api/cursor/sessions/:sessionId/messages?projectName=<name>&limit=<n>&offsetBegin=<n>&offsetEnd=<n>`

Get paginated messages for a session.

| Param | Required | Description |
|-------|----------|-------------|
| `projectName` | Yes | Claude-format project name (e.g., `-home-user-myproject`). Leading `-` is stripped for Cursor lookup. |
| `limit` | No | Max messages to return (default: 50). |
| `offsetBegin` | No | 0-based start index (returns all messages from here to end). |
| `offsetEnd` | No | 0-based end index (returns `limit` messages ending here). |

**Response:**
```json
{
  "messages": [ { "id": "...", "sequence": 1, "content": {...} } ],
  "total": 42,
  "offsetBegin": 30,
  "offsetEnd": 41
}
```

Pagination rules:
- No offset params: returns last `limit` messages
- `offsetEnd`: returns `limit` messages ending at `offsetEnd` (for loading history)
- `offsetBegin`: returns all messages from `offsetBegin` onward (for polling new messages)

#### `DELETE /api/cursor/sessions/:sessionId?projectPath=<path>`

Delete a session. Removes the entire `~/.cursor/chats/{hash}/{sessionId}/` directory.

**Response:**
```json
{ "success": true, "message": "Session abc-123-def deleted successfully" }
```

### 4.4 Sessions via Unified API

Cursor sessions are also accessible through the unified project API:

#### `GET /api/projects/:projectName/sessions?provider=cursor&limit=5&offset=0`

Returns paginated Cursor sessions for a project. The project name uses Claude format (`-home-user-myproject`); internally the leading `-` is stripped and `.workspace-trusted` is read to get the actual path.

#### `POST /api/sessions/batch`

Batch-fetch sessions by ID:

```json
{
  "requests": [
    { "projectName": "-home-user-myproject", "sessionId": "abc-123-def", "provider": "cursor" }
  ]
}
```

---

## 5. Session Discovery & Project Resolution

### 5.1 Cursor Project Path Resolution

Located in `server/projects.js` → `extractCursorProjectPath(encodedName)`:

```
~/.cursor/projects/{encodedName}/.workspace-trusted
    → JSON: { "workspacePath": "/home/user/myproject" }

Fallback: '/' + encodedName.replace(/-/g, '/')
```

The `.workspace-trusted` file is the most reliable source. The fallback path decoding is unreliable for paths containing hyphens.

### 5.2 Chat Directory Resolution

Cursor chats are keyed by MD5 hash of the absolute project path:

```
projectPath = "/home/user/myproject"
hash = MD5(projectPath) = "d5e0f8c05ed899b2e2a24ceea9acdf31"
chatsDir = ~/.cursor/chats/d5e0f8c05ed899b2e2a24ceea9acdf31/
```

Each subdirectory under `chatsDir` is a session UUID containing a `store.db` SQLite file.

### 5.3 Session Listing (getCursorSessions)

Located in `server/projects.js`:

1. Compute `MD5(projectPath)` → `cwdHash`
2. List directories in `~/.cursor/chats/{cwdHash}/`
3. For each session directory:
   a. Open `store.db` in readonly mode
   b. Read `meta` table, key `"0"` → hex-decode → JSON parse → extract `name`, `createdAt`, `mode`
   c. Count JSON blobs: `SELECT COUNT(*) FROM blobs WHERE substr(data, 1, 1) = X'7B'`
   d. Close database
4. Sort by `createdAt` descending
5. Load per-session config (starred, readBlobOffset) from app's session-config database
6. Return paginated results with starred sessions prepended

---

## 6. SQLite Message Extraction (store.db)

Located in `server/routes/cursor.js` → `getCursorMessagesFromDb(storeDbPath)`.

Cursor's `store.db` uses a content-addressable DAG structure, not a simple message list.

### 6.1 Database Schema

```sql
CREATE TABLE blobs (id TEXT PRIMARY KEY, data BLOB);
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
```

- `blobs.id`: SHA-256 hash of the blob data (hex string)
- `blobs.data`: Either JSON (starts with `0x7B` = `{`) or binary (DAG structure refs)

### 6.2 Blob Types

| First Byte | Type | Content |
|-----------|------|---------|
| `0x7B` (`{`) | JSON blob | Message data (`role`, `content`, `tool_calls`, etc.) |
| Other | DAG blob | Binary data with embedded parent hash references |

### 6.3 DAG Reconstruction Algorithm

1. **Classify blobs**: Separate into JSON blobs and binary (DAG) blobs
2. **Extract parent references** from binary blobs:
   - Scan for byte pattern `0x0A 0x20` followed by 32 bytes (SHA-256 hash)
   - If the hash exists in `blobMap`, it's a parent reference
3. **Topological sort**: Visit nodes depth-first, processing parents before children
4. **Map JSON to order**: For each sorted DAG blob, check if it contains any JSON blob's ID (as raw bytes). Assign order indices.
5. **Sort JSON blobs**: Primary sort by DAG-derived order, secondary by `rowid`
6. **Filter**: Skip system messages (`role === 'system'`), return message objects

### 6.4 Output Format

```json
{
  "messages": [
    {
      "id": "a1b2c3...hex",
      "sequence": 1,
      "rowid": 5,
      "content": {
        "role": "user",
        "content": [{ "type": "text", "text": "Hello" }]
      }
    },
    {
      "id": "d4e5f6...hex",
      "sequence": 2,
      "rowid": 8,
      "content": {
        "role": "assistant",
        "content": [
          { "type": "text", "text": "Here is my response" },
          { "type": "tool-call", "toolName": "Read", "args": { "path": "src/main.ts" } }
        ]
      }
    }
  ],
  "metadata": {
    "agent": { "name": "Refactor auth", "createdAt": 1709290000000, "mode": "agent" }
  }
}
```

---

## 7. Message Conversion (SQLite → ChatMessage)

Located in `src/components/chat/utils/messageTransforms.ts` → `convertCursorSessionMessages()`.

Converts raw SQLite blobs into `ChatMessage[]` for the React frontend.

### 7.1 Role Mapping

| Cursor Role | ChatMessage Type |
|-------------|-----------------|
| `user` | `'user'` |
| `assistant` | `'assistant'` |
| `tool` | Processed as tool results, not a standalone message |
| `system` | Skipped |

### 7.2 Content Part Handling

Each blob's `content.content` is an array of parts:

| Part Type | Handling |
|-----------|---------|
| `text` | Extracted as message text |
| `reasoning` | Stored as `message.reasoning` |
| `tool-call` / `tool_use` | Creates a tool use message |
| `tool-result` | Matched to preceding tool use by `toolCallId` |

### 7.3 Tool Name Normalization

| Cursor Tool Name | Normalized Name |
|-----------------|-----------------|
| `ApplyPatch` | `Edit` |
| Others | Kept as-is |

### 7.4 Tool Input Transformation

**Edit (ApplyPatch)**: Parses unified diff format from `args.patch`:

```
@@ -1,3 +1,3 @@
-old line
+new line
 context line
```

Converted to:
```json
{
  "file_path": "/absolute/path/to/file.ts",
  "old_string": "old line\ncontext line",
  "new_string": "new line\ncontext line"
}
```

**Read**: `args.path` → `{ "file_path": "/absolute/path" }`

**Write**: `args.path` + `args.contents` → `{ "file_path": "/absolute/path", "content": "..." }`

File paths are resolved to absolute using the project path.

### 7.5 User Message Parsing

User messages are passed through `parseUserMessage()` which extracts:
- `systemContext`: Content within `<system_context>` XML tags
- `attachedFiles`: Content within `<attached_files>` tags
- `systemReminder`: Content within `<system_reminder>` tags
- `text`: Remaining visible text

### 7.6 Sorting

Final messages sorted by: `sequence` (primary) → `rowid` (secondary) → `timestamp` (tertiary).

---

## 8. Change Detection (Polling Loop)

Located in `server/index.js`.

Cursor sessions use SQLite databases which are not reliably watchable with file system watchers, so a polling loop is used instead.

### 8.1 Poll Interval

Every **30 seconds** (`CURSOR_POLL_INTERVAL_MS = 30_000`).

### 8.2 Algorithm

```
For each project hash in ~/.cursor/chats/:
  1. Look up project name from hash → project name mapping
  2. For each session directory:
     a. Open store.db (readonly)
     b. SELECT COUNT(*) FROM blobs WHERE substr(data, 1, 1) = X'7B'
     c. Compare with cached count for this session
     d. If changed, mark session as updated
  3. Close database
```

### 8.3 Hash-to-Project Mapping

`buildCursorHashToProjectNameMap()` scans `~/.cursor/projects/`:

1. For each project directory, read `.workspace-trusted` → `workspacePath`
2. Compute `MD5(workspacePath)` → hash
3. Map: `hash → '-' + cursorFolderName` (Claude canonical format)

Fallback: decode folder name as `'/' + name.replace(/-/g, '/')`

### 8.4 Cache

`cursorBlobCache` Map stores `"${projectHash}:${sessionId}" → lastBlobOffset`.

On first scan, all sessions are cached without triggering updates. Subsequent scans compare against cached values and only emit updates for changed sessions.

### 8.5 Broadcast

Changed sessions are broadcast to all connected WebSocket clients:

```json
{
  "type": "sessions_updated",
  "updates": {
    "-projectname": {
      "sessionIds": ["changed-session-1"],
      "provider": "cursor"
    }
  },
  "timestamp": "2026-03-01T12:00:00.000Z",
  "watchProvider": "cursor"
}
```

---

## 9. Shell (PTY) Integration

Located in `server/index.js` → `handleShellConnection()`.

### 9.1 Shell Command Construction

When `provider === 'cursor'`:

**Linux/macOS:**
```bash
# New session
cd "/home/user/myproject" && cursor-agent

# Resume session
cd "/home/user/myproject" && cursor-agent --resume="abc-123-def"
```

**Windows:**
```powershell
# New session
Set-Location -Path "C:\Users\user\myproject"; cursor-agent

# Resume session
Set-Location -Path "C:\Users\user\myproject"; cursor-agent --resume="abc-123-def"
```

### 9.2 PTY Session Management

- Sessions are spawned using `node-pty` with `xterm-256color` terminal type
- Session output is buffered (up to 5000 chunks) for reconnection replay
- Sessions persist for 30 minutes after WebSocket disconnect
- On reconnect, buffered output is replayed to the client

### 9.3 Auth URL Detection

The shell handler detects authentication URLs in cursor-agent output (e.g., OAuth login flows) and emits `auth_url` events to the frontend for auto-opening.

---

## 10. Data Structures & Types

### 10.1 Frontend Types (`src/types/app.ts`)

```typescript
type SessionProvider = 'claude' | 'cursor' | 'codex' | 'gemini';

interface ProjectSession {
  id: string;
  title?: string;
  summary?: string;
  name?: string;
  createdAt?: string;
  lastActivity?: string;
  messageCount?: number;
  lastBlobOffset?: number;      // Cursor-specific: total JSON blob count
  readBlobOffset?: number | null; // Cursor-specific: last read blob offset
  readAt?: string | null;       // Claude/Codex/Gemini: last read timestamp
  starred?: boolean;
  __provider?: SessionProvider;
  __projectName?: string;
}

interface Project {
  name: string;               // Claude format: "-home-user-myproject"
  cursorName?: string;        // Cursor format: "home-user-myproject"
  path: string;
  fullPath: string;
  displayName: string;
  sessions: ProjectSession[];         // Claude sessions
  cursorSessions: ProjectSession[];   // Cursor sessions
  codexSessions: ProjectSession[];    // Codex sessions
  geminiSessions: ProjectSession[];   // Gemini sessions
  sessionMeta: { hasMore: boolean; total: number };
  cursorSessionMeta?: { hasMore: boolean; total: number };
}
```

### 10.2 Cursor Models (`shared/modelConstants.js`)

```javascript
export const CURSOR_MODELS = {
  OPTIONS: [
    { value: 'gpt-5.2-high', label: 'GPT-5.2 High' },
    { value: 'gemini-3-pro', label: 'Gemini 3 Pro' },
    { value: 'opus-4.5-thinking', label: 'Claude 4.5 Opus (Thinking)' },
    { value: 'gpt-5.2', label: 'GPT-5.2' },
    { value: 'gpt-5.1', label: 'GPT-5.1' },
    { value: 'gpt-5.1-high', label: 'GPT-5.1 High' },
    { value: 'composer-1', label: 'Composer 1' },
    { value: 'auto', label: 'Auto' },
    { value: 'sonnet-4.5', label: 'Claude 4.5 Sonnet' },
    { value: 'sonnet-4.5-thinking', label: 'Claude 4.5 Sonnet (Thinking)' },
    { value: 'opus-4.5', label: 'Claude 4.5 Opus' },
    // ... more options
  ],
  DEFAULT: 'gpt-5'
};
```

### 10.3 Cursor CLI Config (`~/.cursor/cli-config.json`)

```json
{
  "version": 1,
  "model": {
    "modelId": "gpt-5",
    "displayName": "GPT-5"
  },
  "permissions": {
    "allow": [],
    "deny": []
  },
  "editor": { "vimMode": false },
  "hasChangedDefaultModel": false,
  "privacyCache": {
    "ghostMode": false,
    "privacyMode": 3,
    "updatedAt": 1709290000000
  }
}
```

### 10.4 Cursor MCP Config (`~/.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "server-name": {
      "command": "node",
      "args": ["path/to/server.js"],
      "env": { "API_KEY": "..." }
    },
    "remote-server": {
      "url": "https://example.com/mcp",
      "transport": "http",
      "headers": { "Authorization": "Bearer ..." }
    }
  }
}
```

### 10.5 Frontend localStorage Keys

| Key | Type | Description |
|-----|------|-------------|
| `selected-provider` | `string` | Active provider (`'cursor'`) |
| `cursor-model` | `string` | Selected model (e.g., `'gpt-5.2'`) |
| `cursor-tools-settings` | `JSON` | `{ allowedShellCommands: [], skipPermissions: boolean }` |
| `cursorSessionId` (sessionStorage) | `string` | Active Cursor session ID for the current tab |

---

## Source Files Reference

| File | Purpose |
|------|---------|
| `server/cursor-cli.js` | Spawns `cursor-agent`, parses streaming JSON, manages active processes |
| `server/routes/cursor.js` | REST API for config, MCP, sessions, message extraction from SQLite |
| `server/projects.js` | Project discovery, `getCursorSessions()`, `extractCursorProjectPath()` |
| `server/index.js` | WebSocket routing (`cursor-command`), polling loop, shell PTY for Cursor |
| `shared/modelConstants.js` | `CURSOR_MODELS` definitions |
| `src/utils/api.js` | Frontend API client: `sessionMessages()` with cursor provider, `deleteCursorSession()` |
| `src/components/chat/utils/messageTransforms.ts` | `convertCursorSessionMessages()` — SQLite blobs → ChatMessage[] |
| `src/components/chat/hooks/useChatProviderState.ts` | Cursor model selection, provider state |
| `src/components/chat/hooks/useChatComposerState.ts` | Sends `cursor-command` WebSocket messages |
| `src/components/chat/hooks/useChatSessionState.ts` | Loads Cursor session messages, tracks `cursorSessionId` |
| `src/components/sidebar/utils/utils.ts` | Session display, unread detection via `lastBlobOffset` vs `readBlobOffset` |
| `src/types/app.ts` | TypeScript types for `SessionProvider`, `ProjectSession`, `Project` |
