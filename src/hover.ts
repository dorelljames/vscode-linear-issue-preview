import * as vscode from 'vscode';
import { LinearClient, NoApiKeyError } from './linearClient';
import { IssueMatcher } from './issueRegex';
import { Issue, StateType } from './types';

const STATE_ICONS: Record<StateType, string> = {
  triage: '🔶',
  backlog: '⚪',
  unstarted: '⚪',
  started: '🟡',
  completed: '🟢',
  canceled: '⚫',
};

const PRIORITY_ICONS: Record<number, string> = {
  0: '',
  1: '🔴',
  2: '🟠',
  3: '🟡',
  4: '🔵',
};

export function stateIcon(type: StateType): string {
  return STATE_ICONS[type] ?? '⚪';
}

export class IssueHoverProvider implements vscode.HoverProvider {
  constructor(
    private client: LinearClient,
    private matcher: IssueMatcher
  ) {}

  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<vscode.Hover | undefined> {
    const match = this.matcher.matchAt(document, position);
    if (!match) {
      return undefined;
    }

    let issue: Issue | null;
    try {
      issue = await this.client.getIssue(match.identifier);
    } catch (err) {
      if (err instanceof NoApiKeyError) {
        const md = new vscode.MarkdownString(
          `**Linear**: no API key configured. [Set API Key](command:linearIssues.setApiKey)`
        );
        md.isTrusted = true;
        return new vscode.Hover(md, match.range);
      }
      return undefined;
    }
    if (!issue) {
      return undefined;
    }

    return new vscode.Hover(renderHoverCard(issue), match.range);
  }
}

function renderHoverCard(issue: Issue): vscode.MarkdownString {
  const config = vscode.workspace.getConfiguration('linearIssues');
  const maxLen = config.get<number>('hoverDescriptionLength', 600);
  const md = new vscode.MarkdownString(undefined, true);
  md.isTrusted = true;

  const priority =
    issue.priority > 0
      ? ` · ${PRIORITY_ICONS[issue.priority] ?? ''} ${issue.priorityLabel}`
      : '';
  md.appendMarkdown(
    `${stateIcon(issue.state.type)} **${issue.state.name}** · \`${issue.identifier}\`${priority}\n\n`
  );
  md.appendMarkdown(`### ${escapeMd(issue.title)}\n\n`);

  const facts: string[] = [];
  facts.push(issue.assignee ? `👤 ${escapeMd(issue.assignee.displayName)}` : '👤 Unassigned');
  if (issue.project) {
    facts.push(`📁 ${escapeMd(issue.project.name)}`);
  }
  const labels = issue.labels.nodes.map((l) => `\`${l.name}\``).join(' ');
  if (labels) {
    facts.push(`🏷 ${labels}`);
  }
  facts.push(`🕐 updated ${relativeTime(issue.updatedAt)}`);
  md.appendMarkdown(facts.join(' &nbsp;·&nbsp; ') + '\n\n');

  if (issue.description) {
    md.appendMarkdown('---\n\n');
    md.appendMarkdown(truncate(issue.description, maxLen) + '\n\n');
  }

  const arg = encodeURIComponent(JSON.stringify([issue.identifier]));
  md.appendMarkdown('---\n\n');
  md.appendMarkdown(
    [
      `[$(link-external) Open in Linear](${issue.url})`,
      `[$(preview) Details](command:linearIssues.showDetails?${arg} "Full description and comments in a panel")`,
      `[$(git-branch) Copy branch](command:linearIssues.copyBranchName?${arg} "Copy \\"${issue.branchName}\\"")`,
    ].join(' &nbsp;·&nbsp; ')
  );
  return md;
}

function truncate(text: string, maxLen: number): string {
  // Swap embedded images for a compact placeholder; the Details panel renders them.
  const trimmed = text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, (_m, alt: string) => `🖼 *${alt || 'image'}*`)
    .trim();
  if (trimmed.length <= maxLen) {
    return trimmed;
  }
  return trimmed.slice(0, maxLen).replace(/\s+\S*$/, '') + ' …';
}

function escapeMd(text: string): string {
  return text.replace(/([\\`*_{}[\]()#+\-.!<>])/g, '\\$1');
}

export function relativeTime(iso: string): string {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.round(months / 12)}y ago`;
}
