/**
 * Parses and strips Cursor IDE-injected XML tags from user messages.
 *
 * Cursor wraps every user message in <user_query>...</user_query> and prepends
 * system context blocks (<user_info>, <git_status>, <rules>, etc.) to the first
 * message of each session.
 */

export interface SystemContext {
  userInfo?: { raw: string; os?: string; shell?: string; workspace?: string; date?: string };
  gitStatus?: { raw: string; summary?: string };
  rules?: { name: string; description?: string; content: string }[];
  projectLayout?: string;
  agentTranscripts?: string;
}

export interface ParsedUserMessage {
  /** The actual user text with wrapper tags stripped */
  text: string;
  /** Extracted system context (only present on first message of a session) */
  systemContext?: SystemContext;
  /** Raw content of <attached_files> block if present */
  attachedFiles?: string;
  /** Whether a <system_reminder> was present */
  systemReminder?: string;
}

function extractTagContent(text: string, tagName: string): { content: string; remaining: string } | null {
  const openTag = new RegExp(`<${tagName}(?:\\s[^>]*)?>`, 's');
  const openMatch = openTag.exec(text);
  if (!openMatch) return null;

  const closeTag = `</${tagName}>`;
  const closeIdx = text.indexOf(closeTag, openMatch.index + openMatch[0].length);
  if (closeIdx === -1) return null;

  const content = text.slice(openMatch.index + openMatch[0].length, closeIdx).trim();
  const remaining = (text.slice(0, openMatch.index) + text.slice(closeIdx + closeTag.length)).trim();
  return { content, remaining };
}

function parseUserInfo(raw: string): SystemContext['userInfo'] {
  const info: SystemContext['userInfo'] = { raw };
  const osMatch = raw.match(/OS Version:\s*(.+)/);
  if (osMatch) info.os = osMatch[1].trim();
  const shellMatch = raw.match(/Shell:\s*(.+)/);
  if (shellMatch) info.shell = shellMatch[1].trim();
  const wsMatch = raw.match(/Workspace Path:\s*(.+)/);
  if (wsMatch) info.workspace = wsMatch[1].trim();
  const dateMatch = raw.match(/Today's date:\s*(.+)/);
  if (dateMatch) info.date = dateMatch[1].trim();
  return info;
}

function parseGitStatus(raw: string): SystemContext['gitStatus'] {
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
  const summary = lines.find(l => l.startsWith('##')) || lines[0] || '';
  return { raw, summary };
}

function parseRules(raw: string): SystemContext['rules'] {
  const rules: SystemContext['rules'] = [];

  const ruleRegex = /<(?:always_applied_workspace_rule|agent_requestable_workspace_rule)\s+(?:name|fullPath)="([^"]*)">([\s\S]*?)<\/(?:always_applied_workspace_rule|agent_requestable_workspace_rule)>/g;
  let match;
  while ((match = ruleRegex.exec(raw)) !== null) {
    const fullPath = match[1];
    const name = fullPath.split('/').pop()?.replace(/\.mdc$/, '') || fullPath;
    rules.push({ name, description: fullPath, content: match[2].trim() });
  }

  // Also pick up rules that only have a description attribute (agent_requestable without body)
  const descRegex = /<agent_requestable_workspace_rule\s+fullPath="([^"]*)"[^>]*>([^<]*)</g;
  while ((match = descRegex.exec(raw)) !== null) {
    const fullPath = match[1];
    const name = fullPath.split('/').pop()?.replace(/\.mdc$/, '') || fullPath;
    const desc = match[2].trim();
    if (!rules.some(r => r.description === fullPath)) {
      rules.push({ name, description: fullPath, content: desc });
    }
  }

  return rules;
}

export function parseUserMessage(text: string): ParsedUserMessage {
  if (!text || typeof text !== 'string') {
    return { text: text || '' };
  }

  let remaining = text;
  let systemContext: SystemContext | undefined;
  let attachedFiles: string | undefined;
  let systemReminder: string | undefined;

  // Extract <user_info>
  const userInfoResult = extractTagContent(remaining, 'user_info');
  if (userInfoResult) {
    if (!systemContext) systemContext = {};
    systemContext.userInfo = parseUserInfo(userInfoResult.content);
    remaining = userInfoResult.remaining;
  }

  // Extract <git_status>
  const gitResult = extractTagContent(remaining, 'git_status');
  if (gitResult) {
    if (!systemContext) systemContext = {};
    systemContext.gitStatus = parseGitStatus(gitResult.content);
    remaining = gitResult.remaining;
  }

  // Extract <rules> (contains nested rule tags)
  const rulesResult = extractTagContent(remaining, 'rules');
  if (rulesResult) {
    if (!systemContext) systemContext = {};
    systemContext.rules = parseRules(rulesResult.content);
    remaining = rulesResult.remaining;
  }

  // Extract <project_layout>
  const layoutResult = extractTagContent(remaining, 'project_layout');
  if (layoutResult) {
    if (!systemContext) systemContext = {};
    systemContext.projectLayout = layoutResult.content;
    remaining = layoutResult.remaining;
  }

  // Extract <agent_transcripts>
  const transcriptsResult = extractTagContent(remaining, 'agent_transcripts');
  if (transcriptsResult) {
    if (!systemContext) systemContext = {};
    systemContext.agentTranscripts = transcriptsResult.content;
    remaining = transcriptsResult.remaining;
  }

  // Extract <attached_files>
  const attachedResult = extractTagContent(remaining, 'attached_files');
  if (attachedResult) {
    attachedFiles = attachedResult.content;
    remaining = attachedResult.remaining;
  }

  // Extract <system_reminder>
  const reminderResult = extractTagContent(remaining, 'system_reminder');
  if (reminderResult) {
    systemReminder = reminderResult.content;
    remaining = reminderResult.remaining;
  }

  // Strip <user_query> wrapper (present on every message)
  const userQueryResult = extractTagContent(remaining, 'user_query');
  if (userQueryResult) {
    remaining = userQueryResult.content;
  }

  return {
    text: remaining.trim(),
    systemContext: systemContext || undefined,
    attachedFiles,
    systemReminder,
  };
}
