# Plan: Independent Cursor Project Discovery

## Objective

Refactor `getProjects()` to discover Cursor projects independently (not dependent on Claude project list), then merge with Claude projects.

---

## Current State Analysis

### Current `getProjects()` Flow
1. Scan `~/.claude/projects/` for Claude project folders
2. For each Claude project, extract actual project path from JSONL files
3. Call `getCursorSessions(actualProjectDir)` to find Cursor sessions by MD5-hashing the path
4. Add manually added projects from config

### Problem
- Cursor projects can ONLY be discovered if they also exist as Claude projects
- If a project has Cursor sessions but no Claude sessions, it won't appear in the UI
- The discovery is coupled: Cursor depends on Claude's project list

---

## ~/.cursor Folder Structure Investigation

### Key Discovery: TWO DIFFERENT STORAGE SYSTEMS

Cursor has **two separate chat systems** with different storage:

#### 1. Cursor IDE Chat (`~/.cursor/chats/`)
- **Purpose**: Inline/sidebar chat, composer mode (the main Cursor chat UI)
- **Storage**: SQLite database (`store.db`) with complex DAG structure
- **Folder naming**: MD5 hash of project path → **CANNOT reverse**
- **Session naming**: UUID folders

```
~/.cursor/chats/{md5_hash}/{session_uuid}/
├── store.db          # SQLite with messages in DAG structure
├── store.db-shm      # SQLite shared memory
└── store.db-wal      # SQLite write-ahead log
```

#### 2. Cursor Agent (`~/.cursor/projects/`)
- **Purpose**: Background agent mode (similar to Claude Code agent)
- **Storage**: Simple JSONL files in `agent-transcripts/`
- **Folder naming**: Path-encoded (replace `/` with `-`)
- **Session naming**: UUID.jsonl files

```
~/.cursor/projects/{path-encoded}/
├── .workspace-trusted    # ⭐ CONTAINS ACTUAL PROJECT PATH!
├── agent-transcripts/    # Agent conversation logs (.jsonl)
│   └── {session_uuid}.jsonl
├── mcps/                 # MCP server configurations
├── terminals/            # Terminal session data  
├── repo.json             # Project ID (UUID)
└── worker.log            # Worker process logs
```

### Critical Finding: `.workspace-trusted` Contains Original Path!

```json
{
  "trustedAt": "2026-01-16T13:01:29.435Z",
  "workspacePath": "/localhome/local-eyao/nimcraft"  // ⭐ ACTUAL PATH!
}
```

This solves the path decoding problem! Instead of reversing `-` to `/` (which fails for paths with hyphens), we can read the `.workspace-trusted` file.

### Session ID Correlation

The **same session UUID** appears in both locations:
- `~/.cursor/chats/{md5}/184de124-4c13-49f4-af60-6f15386caeee/store.db`
- `~/.cursor/projects/{encoded}/agent-transcripts/184de124-4c13-49f4-af60-6f15386caeee.jsonl`

This means:
- IDE Chat sessions (`store.db`) = Full chat data with messages
- Agent transcripts (`.jsonl`) = Simplified transcript of agent conversations

### Naming Scheme Comparison

| Location | Naming Scheme | Reversible? | Data Format |
|----------|--------------|-------------|-------------|
| `~/.cursor/projects/` | Path-encoded | YES (via `.workspace-trusted`) | JSONL |
| `~/.cursor/chats/` | MD5 hash | NO | SQLite |

### Relationship Mapping

```
Project Path: /localhome/local-eyao/nimcraft
     │
     ├─► ~/.cursor/projects/localhome-local-eyao-nimcraft/
     │   ├── .workspace-trusted  → {"workspacePath": "/localhome/local-eyao/nimcraft"}
     │   └── agent-transcripts/  → Agent mode conversations (.jsonl)
     │
     └─► ~/.cursor/chats/d5e0f8c05ed899b2e2a24ceea9acdf31/
         └── {session-uuid}/store.db  → IDE Chat conversations (SQLite)
```

### store.db vs agent-transcripts Comparison

| Aspect | store.db (IDE Chat) | agent-transcripts (Agent) |
|--------|---------------------|---------------------------|
| **Format** | SQLite with DAG structure | Simple JSONL |
| **Messages** | Full content with tool calls | Simplified transcript |
| **Ordering** | Complex parent-child refs | Sequential lines |
| **Use case** | Cursor IDE chat UI | Background agent mode |

---

## Implementation Plan

### Phase 1: Refactor `getCursorSessions()` → Only Agent Sessions

**Current behavior**: Fetches IDE chat sessions from `~/.cursor/chats/{md5}/*/store.db`

**New behavior**: Fetch only agent sessions from `~/.cursor/projects/{encoded}/agent-transcripts/*.jsonl`

This aligns with the CLI-focused approach (agent mode = background agent like Claude Code).

### Phase 2: Add Independent Cursor Project Discovery

Create `getCursorProjects()` that:

1. Scan `~/.cursor/projects/` directory
2. Get actual path via `.workspace-trusted` OR fallback to JSONL cwd extraction
3. Fetch sessions INSIDE the function (like `getClaudeProjects` does)
4. Return projects WITH sessions already populated

```javascript
// Extract project path from Cursor project folder
async function extractCursorProjectPath(encodedName) {
  const projectDir = path.join(os.homedir(), '.cursor', 'projects', encodedName);
  
  // Method 1: Read .workspace-trusted (preferred, most reliable)
  try {
    const trustedPath = path.join(projectDir, '.workspace-trusted');
    const trustedData = JSON.parse(await fs.readFile(trustedPath, 'utf8'));
    if (trustedData.workspacePath) {
      return trustedData.workspacePath;
    }
  } catch {
    // .workspace-trusted doesn't exist, try fallback
  }
  
  // Method 2: Decode folder name (fallback - may fail for paths with hyphens)
  // Note: Unlike Claude JSONL files, Cursor agent-transcripts don't contain cwd field
  return '/' + encodedName.replace(/-/g, '/');
}

// Get Cursor projects WITH sessions (like getClaudeProjects pattern)
async function getCursorProjects() {
  const cursorProjectsDir = path.join(os.homedir(), '.cursor', 'projects');
  const projects = [];
  
  try {
    await fs.access(cursorProjectsDir);
    const entries = await fs.readdir(cursorProjectsDir, { withFileTypes: true });
    
    for (const entry of entries.filter(e => e.isDirectory())) {
      // Skip temporary folders
      if (entry.name.startsWith('tmp-')) continue;
      
      // Get actual project path
      const projectPath = await extractCursorProjectPath(entry.name);
      
      // Verify path exists
      try {
        await fs.access(projectPath);
      } catch {
        continue; // Path doesn't exist, skip
      }
      
      // Get sessions FROM THIS PROJECT (agent-transcripts)
      const sessions = await getCursorAgentSessions(entry.name);
      
      projects.push({
        encodedName: entry.name,
        path: projectPath,
        displayName: await generateDisplayName(entry.name, projectPath),
        fullPath: projectPath,
        cursorSessions: sessions,
        source: 'cursor'
      });
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('Error reading Cursor projects:', error);
    }
  }
  
  return projects;
}
```

### Phase 3: Add `getCursorAgentSessions()` Function

New function to parse agent-transcripts JSONL files:

```javascript
// Get agent sessions from ~/.cursor/projects/{encoded}/agent-transcripts/
async function getCursorAgentSessions(encodedProjectName, limit = 5) {
  const transcriptsDir = path.join(
    os.homedir(), '.cursor', 'projects', encodedProjectName, 'agent-transcripts'
  );
  const sessions = [];
  
  try {
    await fs.access(transcriptsDir);
    const entries = await fs.readdir(transcriptsDir, { withFileTypes: true });
    
    // Get .jsonl files and folders (sessions can be either)
    const sessionEntries = entries.filter(e => 
      e.name.endsWith('.jsonl') || e.isDirectory()
    );
    
    // Sort by modification time (newest first)
    const withStats = await Promise.all(
      sessionEntries.map(async (e) => {
        const fullPath = path.join(transcriptsDir, e.name);
        const stat = await fs.stat(fullPath);
        return { entry: e, mtime: stat.mtime, path: fullPath };
      })
    );
    withStats.sort((a, b) => b.mtime - a.mtime);
    
    // Process top N sessions
    for (const { entry, mtime, path: entryPath } of withStats.slice(0, limit)) {
      const sessionId = entry.name.replace('.jsonl', '');
      
      // Determine jsonl file path
      let jsonlPath = entryPath;
      if (entry.isDirectory()) {
        // Look for .jsonl inside the folder
        const files = await fs.readdir(entryPath);
        const jsonl = files.find(f => f.endsWith('.jsonl'));
        if (jsonl) jsonlPath = path.join(entryPath, jsonl);
        else continue;
      }
      
      // Parse session metadata from JSONL
      const sessionData = await parseCursorAgentSession(jsonlPath);
      
      sessions.push({
        id: sessionId,
        name: sessionData.summary || 'Agent Session',
        createdAt: mtime.toISOString(),
        lastActivity: mtime.toISOString(),
        messageCount: sessionData.messageCount || 0,
        lastUserMessage: sessionData.lastUserMessage,
        provider: 'cursor-agent'
      });
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn('Error reading Cursor agent sessions:', error.message);
    }
  }
  
  return sessions;
}

// Parse a Cursor agent JSONL transcript
async function parseCursorAgentSession(jsonlPath) {
  let messageCount = 0;
  let lastUserMessage = null;
  
  try {
    const content = await fs.readFile(jsonlPath, 'utf8');
    const lines = content.split('\n').filter(l => l.trim());
    
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        messageCount++;
        
        // Extract user message for summary
        if (entry.role === 'user' && entry.message?.content) {
          const text = Array.isArray(entry.message.content)
            ? entry.message.content.find(c => c.type === 'text')?.text
            : entry.message.content;
          if (text && !text.startsWith('<')) {
            lastUserMessage = text.length > 80 
              ? text.substring(0, 80) + '...' 
              : text;
          }
        }
      } catch {}
    }
  } catch {}
  
  return {
    messageCount,
    lastUserMessage,
    summary: lastUserMessage || 'Agent Session'
  };
}
```

### Phase 4: Refactor `getProjects()` to Merge Sources

Modify `getProjects()` flow - sessions are now fetched INSIDE each provider's function:

```
┌─────────────────────────────┐    ┌─────────────────────────────┐
│  getClaudeProjects()        │    │  getCursorProjects()        │
│  - Scan ~/.claude/projects  │    │  - Scan ~/.cursor/projects  │
│  - Get path from JSONL cwd  │    │  - Get path from .workspace │
│  - Fetch Claude sessions    │    │  - Fetch agent sessions     │
└──────────────┬──────────────┘    └──────────────┬──────────────┘
               │                                  │
               └─────────────┬────────────────────┘
                             │
                     ┌───────▼───────┐
                     │  Merge by     │
                     │  project path │
                     └───────┬───────┘
                             │
                     ┌───────▼───────┐
                     │ For merged:   │
                     │ - Codex sess  │
                     │ - Gemini sess │
                     │ - Taskmaster  │
                     └───────────────┘
```

### Phase 5: Handle Edge Cases

1. **Temporary folders**: Skip `tmp-*` prefixed directories
2. **Missing `.workspace-trusted`**: Fall back to folder name decoding
3. **Non-existent paths**: Skip projects where decoded path no longer exists
4. **Duplicate projects**: Merge - Claude data takes precedence, add Cursor sessions

---

## Detailed Code Changes

### File: `server/projects.js`

#### 1. Add `extractCursorProjectPath()` - Path Discovery with Fallback

```javascript
async function extractCursorProjectPath(encodedName) {
  const projectDir = path.join(os.homedir(), '.cursor', 'projects', encodedName);
  
  // Method 1: Read .workspace-trusted (preferred, most reliable)
  try {
    const trustedPath = path.join(projectDir, '.workspace-trusted');
    const trustedData = JSON.parse(await fs.readFile(trustedPath, 'utf8'));
    if (trustedData.workspacePath) {
      return trustedData.workspacePath;
    }
  } catch {
    // .workspace-trusted doesn't exist, try fallback
  }
  
  // Method 2: Decode folder name (fallback - may fail for paths with hyphens)
  // Note: Unlike Claude JSONL files, Cursor agent-transcripts don't contain cwd field
  return '/' + encodedName.replace(/-/g, '/');
}
```

#### 2. Add `getCursorAgentSessions()` - Parse Agent Transcripts

```javascript
async function getCursorAgentSessions(encodedProjectName, limit = 5) {
  const transcriptsDir = path.join(
    os.homedir(), '.cursor', 'projects', encodedProjectName, 'agent-transcripts'
  );
  const sessions = [];
  
  try {
    const entries = await fs.readdir(transcriptsDir, { withFileTypes: true });
    
    // Get .jsonl files and session folders
    const sessionEntries = entries.filter(e => 
      (e.isFile() && e.name.endsWith('.jsonl')) || e.isDirectory()
    );
    
    // Sort by modification time
    const withStats = await Promise.all(
      sessionEntries.map(async (e) => {
        const fullPath = path.join(transcriptsDir, e.name);
        const stat = await fs.stat(fullPath);
        return { entry: e, mtime: stat.mtime, path: fullPath };
      })
    );
    withStats.sort((a, b) => b.mtime - a.mtime);
    
    for (const { entry, mtime, path: entryPath } of withStats.slice(0, limit)) {
      const sessionId = entry.name.replace('.jsonl', '');
      const sessionData = await parseCursorAgentSession(
        entry.isDirectory() ? entryPath : entryPath
      );
      
      sessions.push({
        id: sessionId,
        summary: sessionData.summary || 'Agent Session',
        createdAt: mtime.toISOString(),
        lastActivity: mtime.toISOString(),
        messageCount: sessionData.messageCount,
        provider: 'cursor-agent'
      });
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn('Error reading Cursor agent sessions:', error.message);
    }
  }
  
  return sessions;
}
```

#### 3. Add `getCursorProjects()` - Full Project Discovery with Sessions

```javascript
async function getCursorProjects(progressCallback = null) {
  const cursorProjectsDir = path.join(os.homedir(), '.cursor', 'projects');
  const projects = [];
  
  try {
    await fs.access(cursorProjectsDir);
    const entries = await fs.readdir(cursorProjectsDir, { withFileTypes: true });
    const directories = entries.filter(e => e.isDirectory() && !e.name.startsWith('tmp-'));
    
    for (const entry of directories) {
      // Get actual project path (with fallback chain)
      const projectPath = await extractCursorProjectPath(entry.name);
      
      // Verify path exists
      try {
        await fs.access(projectPath);
      } catch {
        continue; // Skip non-existent paths
      }
      
      // Get sessions (inside this function, like Claude pattern)
      const cursorSessions = await getCursorAgentSessions(entry.name);
      
      projects.push({
        name: entry.name,
        path: projectPath,
        displayName: await generateDisplayName(entry.name, projectPath),
        fullPath: projectPath,
        cursorSessions: cursorSessions,
        sessions: [], // No Claude sessions
        isCursorOnly: true
      });
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('Error reading Cursor projects:', error);
    }
  }
  
  return projects;
}
```

#### 4. Refactor `getProjects()` - Merge Sources

```javascript
async function getProjects(progressCallback = null) {
  const projectMap = new Map(); // path -> project data
  
  // Step 1: Get Claude projects (with sessions already populated)
  const claudeProjects = await getClaudeProjects(progressCallback);
  for (const proj of claudeProjects) {
    projectMap.set(proj.path, proj);
  }
  
  // Step 2: Get Cursor projects (with cursorSessions already populated)
  const cursorProjects = await getCursorProjects();
  for (const cursorProj of cursorProjects) {
    if (projectMap.has(cursorProj.path)) {
      // Project exists in both - merge Cursor sessions into existing
      const existing = projectMap.get(cursorProj.path);
      existing.cursorSessions = cursorProj.cursorSessions;
    } else {
      // New project only in Cursor
      projectMap.set(cursorProj.path, cursorProj);
    }
  }
  
  // Step 3: For each project, fetch additional session types
  for (const [projectPath, project] of projectMap) {
    // Codex sessions (if not already fetched)
    if (!project.codexSessions) {
      project.codexSessions = await getCodexSessions(projectPath);
    }
    // Gemini sessions
    if (!project.geminiSessions) {
      project.geminiSessions = sessionManager.getProjectSessions(projectPath) || [];
    }
    // Taskmaster detection
    // ... existing taskmaster logic
  }
  
  return Array.from(projectMap.values());
}
```

#### 5. Remove/Deprecate Old `getCursorSessions()` 

The old function that reads from `~/.cursor/chats/` (IDE chat) should be:
- Removed entirely, OR
- Renamed to `getCursorIDEChatSessions()` if we want to keep it as an option

---

## Tasks Checklist

- [ ] 1. Create `doc/` folder and document `~/.cursor` folder structure
- [ ] 2. Add `extractCursorProjectPath()` with fallback chain
- [ ] 3. Add `getCursorAgentSessions()` to parse agent-transcripts
- [ ] 4. Add `parseCursorAgentSession()` helper
- [ ] 5. Add `getCursorProjects()` (with sessions inside, like Claude pattern)
- [ ] 6. Refactor `getProjects()` to merge Claude and Cursor projects
- [ ] 7. Remove/deprecate old `getCursorSessions()` (IDE chat detection)
- [ ] 8. Test with projects that exist only in Cursor
- [ ] 9. Test with projects that exist in both
- [ ] 10. Update UI if needed (session type indicators?)

---

## Questions Resolved

1. ~~**Path decoding accuracy**~~: **SOLVED** - Use `.workspace-trusted` with JSONL cwd fallback!

2. **Priority handling**: When a project exists in both Claude and Cursor, Claude metadata takes precedence (added first), Cursor sessions are merged in.

3. **Performance**: Can parallelize Claude and Cursor discovery with `Promise.all()`.

4. **Session architecture**: Follow same pattern as Claude - fetch sessions INSIDE the project discovery function.

5. **Which Cursor sessions?**: Only agent-transcripts (CLI agent mode), NOT IDE chat sessions.

---

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| Missing `.workspace-trusted` | Medium | Fallback to folder name decoding (may be inaccurate) |
| Folder name decoding fails | Low | Only affects paths with hyphens in directory names |
| Performance regression | Low | Use parallel scanning with `Promise.all()` |
| Breaking existing functionality | Medium | Old IDE chat sessions no longer shown |

---

## Breaking Changes

**Old behavior**: `getCursorSessions()` returned IDE chat sessions from `~/.cursor/chats/`

**New behavior**: `getCursorSessions()` returns agent sessions from `~/.cursor/projects/agent-transcripts/`

Users who relied on seeing IDE chat sessions will no longer see them. This is intentional - the focus is on CLI/agent sessions (similar to Claude Code).

---

## Next Steps

After reviewing this plan:
1. Create the `doc/` folder with Cursor folder structure documentation
2. Implement `extractCursorProjectPath()` with fallback chain
3. Implement `getCursorAgentSessions()` 
4. Implement `getCursorProjects()` with sessions inside
5. Refactor `getProjects()` to merge sources
6. Remove/deprecate old `getCursorSessions()`
7. Test the changes
