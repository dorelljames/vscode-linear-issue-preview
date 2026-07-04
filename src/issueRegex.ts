import * as vscode from 'vscode';
import { LinearClient } from './linearClient';

/** Generic fallback shape of a Linear issue key: 1-10 uppercase alphanumerics, dash, number. */
const GENERIC_PATTERN = /\b([A-Z][A-Z0-9]{0,9})-(\d{1,7})\b/g;

const MAX_MATCHES_PER_DOCUMENT = 200;

export interface IssueMatch {
  identifier: string;
  range: vscode.Range;
}

export class IssueMatcher {
  private teamKeys: Set<string> | null = null;

  constructor(private client: LinearClient) {
    client.onDidChangeAuth(() => {
      this.teamKeys = null;
      void this.refreshTeamKeys();
    });
    void this.refreshTeamKeys();
  }

  async refreshTeamKeys(): Promise<void> {
    const configured = vscode.workspace
      .getConfiguration('linearIssues')
      .get<string[]>('teamKeys', []);
    if (configured.length > 0) {
      this.teamKeys = new Set(configured.map((k) => k.toUpperCase()));
      return;
    }
    const meta = await this.client.getWorkspaceMeta();
    if (meta) {
      this.teamKeys = new Set(meta.teamKeys.map((k) => k.toUpperCase()));
    }
  }

  /**
   * Whether an identifier looks like one of ours. When team keys are unknown
   * (not authenticated yet), accept the generic shape and let the API decide.
   */
  isKnownTeam(identifier: string): boolean {
    if (!this.teamKeys) {
      return true;
    }
    const prefix = identifier.split('-')[0].toUpperCase();
    return this.teamKeys.has(prefix);
  }

  matchesIn(document: vscode.TextDocument): IssueMatch[] {
    const results: IssueMatch[] = [];
    const text = document.getText();
    GENERIC_PATTERN.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = GENERIC_PATTERN.exec(text)) !== null) {
      const identifier = m[0].toUpperCase();
      if (!this.isKnownTeam(identifier)) {
        continue;
      }
      results.push({
        identifier,
        range: new vscode.Range(
          document.positionAt(m.index),
          document.positionAt(m.index + m[0].length)
        ),
      });
      if (results.length >= MAX_MATCHES_PER_DOCUMENT) {
        break;
      }
    }
    return results;
  }

  matchAt(document: vscode.TextDocument, position: vscode.Position): IssueMatch | undefined {
    const range = document.getWordRangeAtPosition(position, /[A-Za-z][A-Za-z0-9]{0,9}-\d{1,7}/);
    if (!range) {
      return undefined;
    }
    const identifier = document.getText(range).toUpperCase();
    if (!/^[A-Z][A-Z0-9]{0,9}-\d{1,7}$/.test(identifier) || !this.isKnownTeam(identifier)) {
      return undefined;
    }
    return { identifier, range };
  }
}
