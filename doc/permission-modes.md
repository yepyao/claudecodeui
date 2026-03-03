# Permission Modes

The mode button in the chat interface controls how agents handle file modifications, command execution, and tool approvals.

## Cursor Session Modes

Cursor uses a different mode system called "Session Modes" instead of permission modes.

### Available Cursor Modes

| Mode | Description | CLI Flag |
|------|-------------|----------|
| **Default** | Normal agent mode with full capabilities | (none, or `-f` if skipPermissions enabled) |
| **Ask** | Q&A style for explanations and questions (read-only) | `--mode ask` |
| **Plan** | Read-only planning mode - analyze and propose plans without edits | `--mode plan` |

### How It Works

When you select Ask or Plan mode:
1. The `--mode` flag is passed to `cursor-agent`
2. The `-f` (force/skip permissions) flag is **not** added
3. The agent operates in read-only mode

```javascript
// server/cursor-cli.js
if (sessionMode === 'ask' || sessionMode === 'plan') {
  args.push('--mode', sessionMode);
} else if (skipPermissions || settings.skipPermissions) {
  args.push('-f');
}
```

### Token/Context Usage

Token usage is **not available** for Cursor sessions - the `cursor-agent` CLI does not output this information. The token usage pie chart is hidden for Cursor sessions.

---

## Permission Modes (Claude, Codex, Gemini)

For non-Cursor providers, the mode button cycles through permission modes.

### Available Permission Modes

| Mode | Description |
|------|-------------|
| **Default** | Conservative mode - only trusted commands run automatically |
| **Accept Edits** | Auto-accept file edits within workspace sandbox |
| **Bypass Permissions** | Full system access with no restrictions |
| **Plan Mode** | Read-only planning mode (Claude only) |

### Claude

Claude respects all permission modes. The mode is passed directly to the Claude SDK:

```javascript
// server/claude-sdk.js
if (permissionMode && permissionMode !== 'default') {
  sdkOptions.permissionMode = permissionMode;
}
```

| Mode | Behavior |
|------|----------|
| `default` | Standard tool approval flow |
| `acceptEdits` | Auto-accept file edits |
| `bypassPermissions` | Skip all permission checks |
| `plan` | Read-only tools only: `Read`, `Task`, `TodoRead`, `TodoWrite`, `WebFetch`, `WebSearch`, `exit_plan_mode` |

### Codex (OpenAI)

Codex maps permission modes to sandbox and approval policy settings:

```javascript
// server/openai-codex.js
function mapPermissionModeToCodexOptions(permissionMode) {
  switch (permissionMode) {
    case 'acceptEdits':
      return { sandboxMode: 'workspace-write', approvalPolicy: 'never' };
    case 'bypassPermissions':
      return { sandboxMode: 'danger-full-access', approvalPolicy: 'never' };
    case 'default':
    default:
      return { sandboxMode: 'workspace-write', approvalPolicy: 'untrusted' };
  }
}
```

| Mode | Sandbox Mode | Approval Policy |
|------|--------------|-----------------|
| `default` | `workspace-write` | `untrusted` (trusted commands only) |
| `acceptEdits` | `workspace-write` | `never` (all auto-execute) |
| `bypassPermissions` | `danger-full-access` | `never` (full system access) |

Note: Codex does not support Plan Mode - it falls back to `default`.

### Gemini

Gemini maps permission modes to CLI flags:

| Mode | Gemini Equivalent | Behavior |
|------|-------------------|----------|
| `default` | Standard | Prompts for approval |
| `auto_edit` | Auto Edit | Auto-accept file edits |
| `yolo` | YOLO Mode | Full auto with no restrictions |

## UI Behavior

The mode is persisted per session in localStorage:
- Cursor: `cursorSessionMode-{sessionId}`
- Others: `permissionMode-{sessionId}`

### Visual Indicators

**Cursor Modes:**
| Mode | Color |
|------|-------|
| Default | Gray |
| Ask | Blue |
| Plan | Purple |

**Permission Modes (Claude/Codex/Gemini):**
| Mode | Color |
|------|-------|
| Default | Gray |
| Accept Edits | Green |
| Bypass Permissions | Orange |
| Plan Mode | Primary/Blue |
