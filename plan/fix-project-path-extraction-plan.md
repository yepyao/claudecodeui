# Plan: Fix Project Path Extraction for Hyphenated Directory Names

## Objective
Fix the 404 error when accessing `/api/projects/-localhome-local-eyao-claudecodeui/files` where directory names contain hyphens.

## Current State
- URL path `-localhome-local-eyao-claudecodeui` gets decoded incorrectly
- `extractProjectDirectory()` falls back to naive `replace(/-/g, '/')` 
- This converts `local-eyao` to `local/eyao` (WRONG)
- Correct path: `/localhome/local-eyao/claudecodeui`
- Decoded path: `/localhome/local/eyao/claudecodeui` (WRONG)

## Root Cause
1. Claude's project directory `~/.claude/projects/-localhome-local-eyao-claudecodeui` doesn't exist
2. Project config has no `originalPath` field
3. Fallback is naive dash-to-slash conversion which is ambiguous

## Solution
Modify `extractProjectDirectory()` to also try Cursor's `.workspace-trusted` file as a fallback before naive conversion.

Cursor stores the correct path in:
`~/.cursor/projects/localhome-local-eyao-claudecodeui/.workspace-trusted`
```json
{"workspacePath": "/localhome/local-eyao/claudecodeui"}
```

## Proposed Changes

### File: `server/projects.js`

In `extractProjectDirectory()` (around line 271), add a fallback to check Cursor's `.workspace-trusted` before the naive dash replacement:

```javascript
// After checking Claude's JSONL files, before naive fallback:

// Try Cursor's .workspace-trusted as fallback
const cursorEncodedName = projectName.startsWith('-') ? projectName.slice(1) : projectName;
const cursorProjectDir = path.join(os.homedir(), '.cursor', 'projects', cursorEncodedName, '.workspace-trusted');
try {
  const trustedData = JSON.parse(await fs.readFile(cursorProjectDir, 'utf8'));
  if (trustedData.workspacePath) {
    projectDirectoryCache.set(projectName, trustedData.workspacePath);
    return trustedData.workspacePath;
  }
} catch {
  // .workspace-trusted doesn't exist
}

// Only then fall back to naive replacement
```

## Tasks
- [ ] Modify `extractProjectDirectory()` to check Cursor's `.workspace-trusted`
- [ ] Test the `/api/projects/:projectName/files` endpoint

## Questions
None - this is a straightforward fix.
