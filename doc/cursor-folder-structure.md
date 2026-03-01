# Cursor Folder Structure (~/.cursor)

This document describes the folder structure of the Cursor IDE configuration directory.

## Overview

Cursor stores data in two main locations with different purposes:

| Location | Purpose | Naming Scheme | Session Format |
|----------|---------|---------------|----------------|
| `~/.cursor/projects/` | Background Agent (CLI) | Path-encoded | JSONL |
| `~/.cursor/chats/` | IDE Chat (sidebar/composer) | MD5 hash | SQLite |

## Directory Structure

```
~/.cursor/
├── projects/                       # Project-specific data (Agent mode)
│   └── {path-encoded-name}/        # e.g., localhome-local-eyao-nimcraft
│       ├── .workspace-trusted      # Contains actual project path!
│       ├── agent-transcripts/      # Agent conversation logs
│       │   ├── {uuid}.jsonl        # Session transcript file
│       │   └── {uuid}/             # Or session folder with nested jsonl
│       ├── mcps/                   # MCP server configurations
│       ├── terminals/              # Terminal session data
│       ├── repo.json               # Project ID (UUID)
│       └── worker.log              # Worker process logs
│
├── chats/                          # Chat sessions (IDE Chat mode)
│   └── {md5_hash}/                 # MD5 hash of project absolute path
│       └── {session_uuid}/
│           ├── store.db            # SQLite database with messages
│           ├── store.db-shm        # SQLite shared memory
│           └── store.db-wal        # SQLite write-ahead log
│
├── agents/                         # Global custom agents (markdown files)
├── cli-config.json                 # CLI configuration (auth, model, permissions)
├── ide_state.json                  # Recently viewed files
├── agent-cli-state.json            # Agent CLI state
├── mcp.json                        # Global MCP server configuration
└── statsig-cache.json              # Feature flags cache
```

## Key Files

### .workspace-trusted

Located in each project folder, contains the actual workspace path:

```json
{
  "trustedAt": "2026-01-16T13:01:29.435Z",
  "workspacePath": "/localhome/local-eyao/nimcraft"
}
```

This is the **most reliable way** to determine the actual project path from a Cursor project folder.

### repo.json

Contains a unique project identifier:

```json
{
  "id": "833c3a28-fad5-4a8a-a0a2-7590a6fa4ff2"
}
```

### agent-transcripts/*.jsonl

Simple JSONL format with conversation entries:

```json
{"role":"user","message":{"content":[{"type":"text","text":"<user_query>...</user_query>"}]}}
{"role":"assistant","message":{"content":[{"type":"text","text":"..."}]}}
```

**Note**: Unlike Claude JSONL files, Cursor agent-transcripts do NOT contain a `cwd` field.

## Naming Schemes

### Project Folder Names (Path-encoded)

The `projects/` folder uses path-encoded names:
- `/localhome/local-eyao/nimcraft` → `localhome-local-eyao-nimcraft`
- Encoding: Replace `/` with `-`
- **Limitation**: Cannot reliably decode paths containing hyphens

### Chat Folder Names (MD5 Hash)

The `chats/` folder uses MD5 hashes of the absolute project path:
- `/localhome/local-eyao/nimcraft` → `d5e0f8c05ed899b2e2a24ceea9acdf31`
- **Cannot be reversed** to get the original path

## Session ID Correlation

The same session UUID can appear in both locations:
- `~/.cursor/projects/{encoded}/agent-transcripts/184de124-...-.jsonl`
- `~/.cursor/chats/{md5}/184de124-.../store.db`

This indicates the session was used in both Agent mode and IDE Chat mode.

## Comparison: Agent vs IDE Chat

| Aspect | Agent (`projects/`) | IDE Chat (`chats/`) |
|--------|---------------------|---------------------|
| **Purpose** | Background agent (like Claude Code) | Inline/sidebar chat |
| **Storage** | Simple JSONL files | SQLite with DAG structure |
| **Path Discovery** | `.workspace-trusted` file | Requires known path to compute MD5 |
| **Message Format** | Sequential entries | Complex parent-child refs |

## Path Discovery Strategy

To find the actual project path from a Cursor project folder:

1. **Preferred**: Read `.workspace-trusted` → `workspacePath`
2. **Fallback**: Decode folder name (`-` → `/`) - may be inaccurate for paths with hyphens

```javascript
async function extractCursorProjectPath(encodedName) {
  const projectDir = path.join(os.homedir(), '.cursor', 'projects', encodedName);
  
  // Method 1: Read .workspace-trusted
  try {
    const trustedPath = path.join(projectDir, '.workspace-trusted');
    const trustedData = JSON.parse(await fs.readFile(trustedPath, 'utf8'));
    if (trustedData.workspacePath) {
      return trustedData.workspacePath;
    }
  } catch {}
  
  // Method 2: Decode folder name (fallback)
  return '/' + encodedName.replace(/-/g, '/');
}
```
