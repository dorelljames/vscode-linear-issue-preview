import * as vscode from 'vscode';
import { marked } from 'marked';
import { LinearClient } from './linearClient';
import { Issue } from './types';
import { relativeTime } from './hover';

/** Singleton webview panel showing the full issue: description, meta, comments. */
export class IssueDetailsPanel {
  private static current: IssueDetailsPanel | undefined;
  private identifier: string | undefined;

  static async show(client: LinearClient, identifier: string): Promise<void> {
    if (!IssueDetailsPanel.current) {
      const panel = vscode.window.createWebviewPanel(
        'linearIssueDetails',
        'Linear Issue',
        { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false },
        { enableScripts: true }
      );
      IssueDetailsPanel.current = new IssueDetailsPanel(panel, client);
    }
    await IssueDetailsPanel.current.render(identifier);
    IssueDetailsPanel.current.panel.reveal(vscode.ViewColumn.Beside);
  }

  private constructor(
    private panel: vscode.WebviewPanel,
    private client: LinearClient
  ) {
    panel.onDidDispose(() => {
      IssueDetailsPanel.current = undefined;
    });
    panel.webview.onDidReceiveMessage(async (msg: { command: string; url?: string }) => {
      if (msg.command === 'open' && msg.url) {
        void vscode.env.openExternal(vscode.Uri.parse(msg.url));
      } else if (msg.command === 'copyBranch') {
        void vscode.commands.executeCommand('linearIssues.copyBranchName', this.identifier);
      } else if (msg.command === 'refresh' && this.identifier) {
        this.client.clearCache();
        await this.render(this.identifier);
      }
    });
  }

  private async render(identifier: string): Promise<void> {
    this.identifier = identifier;
    this.panel.title = identifier;
    this.panel.webview.html = messageHtml(`Loading ${identifier}…`);
    let issue: Issue | null = null;
    let error: string | undefined;
    try {
      issue = await this.client.getIssue(identifier);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
    this.panel.webview.html = issue
      ? await issueHtml(issue, this.client)
      : messageHtml(error ?? `Issue ${identifier} was not found in your Linear workspace.`);
  }
}

async function issueHtml(issue: Issue, client: LinearClient): Promise<string> {
  const nonce = getNonce();
  const description = issue.description
    ? await inlineLinearImages(await marked.parse(issue.description), client)
    : '<p class="muted">No description.</p>';

  const labels = issue.labels.nodes
    .map(
      (l) =>
        `<span class="chip" style="border-color:${cssColor(l.color)}"><span class="dot" style="background:${cssColor(l.color)}"></span>${escapeHtml(l.name)}</span>`
    )
    .join('');

  const comments = issue.comments.nodes.length
    ? (
        await Promise.all(
          issue.comments.nodes.map(
            async (c) => `
        <div class="comment">
          <div class="comment-head">
            <strong>${escapeHtml(c.user?.displayName ?? 'Unknown')}</strong>
            <span class="muted">${relativeTime(c.createdAt)}</span>
          </div>
          <div class="md">${await inlineLinearImages(await marked.parse(c.body), client)}</div>
        </div>`
          )
        )
      ).join('')
    : '<p class="muted">No comments yet.</p>';

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
  body {
    font-family: var(--vscode-font-family);
    color: var(--vscode-foreground);
    padding: 1.2rem 1.6rem 2rem;
    line-height: 1.55;
    max-width: 860px;
  }
  a { color: var(--vscode-textLink-foreground); }
  h1 { font-size: 1.35rem; margin: 0.3rem 0 0.8rem; }
  .muted { color: var(--vscode-descriptionForeground); }
  .topline { display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; }
  .state {
    display: inline-flex; align-items: center; gap: 0.35rem;
    font-weight: 600;
  }
  .dot { width: 0.65em; height: 0.65em; border-radius: 50%; display: inline-block; }
  .identifier { font-family: var(--vscode-editor-font-family); color: var(--vscode-descriptionForeground); }
  .meta { display: flex; gap: 1rem; flex-wrap: wrap; margin: 0.4rem 0 1rem; color: var(--vscode-descriptionForeground); font-size: 0.92em; }
  .chip {
    display: inline-flex; align-items: center; gap: 0.35rem;
    border: 1px solid; border-radius: 999px;
    padding: 0.05rem 0.6rem; font-size: 0.85em; margin-right: 0.3rem;
  }
  .actions { margin: 0.6rem 0 1.2rem; display: flex; gap: 0.5rem; flex-wrap: wrap; }
  button {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: none; border-radius: 4px; padding: 0.35rem 0.8rem; cursor: pointer;
  }
  button.secondary {
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
  }
  hr { border: none; border-top: 1px solid var(--vscode-panel-border); margin: 1.2rem 0; }
  .md pre {
    background: var(--vscode-textCodeBlock-background);
    padding: 0.7rem; border-radius: 6px; overflow-x: auto;
  }
  .md code { font-family: var(--vscode-editor-font-family); font-size: 0.92em; }
  .md img { max-width: 100%; }
  .comment { border-left: 2px solid var(--vscode-panel-border); padding-left: 0.9rem; margin-bottom: 1.1rem; }
  .comment-head { display: flex; gap: 0.6rem; align-items: baseline; }
  h2 { font-size: 1.05rem; margin-top: 1.4rem; }
</style>
</head>
<body>
  <div class="topline">
    <span class="state" style="color:${cssColor(issue.state.color)}">
      <span class="dot" style="background:${cssColor(issue.state.color)}"></span>${escapeHtml(issue.state.name)}
    </span>
    <span class="identifier">${escapeHtml(issue.identifier)}</span>
    ${issue.priority > 0 ? `<span class="muted">${escapeHtml(issue.priorityLabel)} priority</span>` : ''}
  </div>
  <h1>${escapeHtml(issue.title)}</h1>
  <div class="meta">
    <span>👤 ${escapeHtml(issue.assignee?.displayName ?? 'Unassigned')}</span>
    ${issue.project ? `<span>📁 ${escapeHtml(issue.project.name)}</span>` : ''}
    <span>🕐 updated ${relativeTime(issue.updatedAt)}</span>
  </div>
  ${labels ? `<div>${labels}</div>` : ''}
  <div class="actions">
    <button id="open">Open in Linear</button>
    <button id="branch" class="secondary">Copy branch name</button>
    <button id="refresh" class="secondary">Refresh</button>
  </div>
  <hr>
  <div class="md">${description}</div>
  <hr>
  <h2>Comments</h2>
  ${comments}
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    document.getElementById('open').addEventListener('click', () =>
      vscode.postMessage({ command: 'open', url: ${JSON.stringify(issue.url)} }));
    document.getElementById('branch').addEventListener('click', () =>
      vscode.postMessage({ command: 'copyBranch' }));
    document.getElementById('refresh').addEventListener('click', () =>
      vscode.postMessage({ command: 'refresh' }));
  </script>
</body>
</html>`;
}

const IMG_TAG_PATTERN = /<img\b[^>]*\bsrc="([^"]+)"[^>]*>/g;

/**
 * Linear-hosted images (uploads.linear.app) require the API key in an
 * Authorization header, which webview <img> tags can't send. Fetch them via
 * the extension host and swap the src for a data: URI; if a fetch fails,
 * degrade to a link that opens in the browser (where the Linear session works).
 */
async function inlineLinearImages(html: string, client: LinearClient): Promise<string> {
  const sources = new Set<string>();
  for (const match of html.matchAll(IMG_TAG_PATTERN)) {
    if (unescapeAttr(match[1]).startsWith('https://uploads.linear.app/')) {
      sources.add(match[1]);
    }
  }
  if (sources.size === 0) {
    return html;
  }
  const resolved = new Map<string, string | null>();
  await Promise.all(
    [...sources].map(async (src) => {
      resolved.set(src, await client.fetchImageAsDataUri(unescapeAttr(src)));
    })
  );
  return html.replace(IMG_TAG_PATTERN, (tag, src: string) => {
    if (!resolved.has(src)) {
      return tag;
    }
    const dataUri = resolved.get(src);
    if (dataUri) {
      return tag.replace(`src="${src}"`, `src="${dataUri}"`);
    }
    const alt = /\balt="([^"]*)"/.exec(tag)?.[1] || 'attachment';
    return `<a href="${src}">🖼 ${alt} (open in browser)</a>`;
  });
}

function unescapeAttr(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function messageHtml(message: string): string {
  return /* html */ `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 1.5rem; }
</style></head>
<body><p>${escapeHtml(message)}</p></body></html>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Only allow safe CSS color values coming from the API. */
function cssColor(color: string): string {
  return /^#[0-9a-fA-F]{3,8}$/.test(color) ? color : 'var(--vscode-foreground)';
}

function getNonce(): string {
  let text = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
