import * as vscode from 'vscode';
import { LinearClient } from './linearClient';
import { IssueMatcher } from './issueRegex';

const DEBOUNCE_MS = 400;
const MAX_UNIQUE_IDS_PER_DOCUMENT = 50;

/**
 * Renders a subtle "● In Progress" after each issue key, tinted with the
 * workflow state's actual color from Linear.
 */
export class StatusDecorations implements vscode.Disposable {
  private decorationTypes = new Map<string, vscode.TextEditorDecorationType>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private disposables: vscode.Disposable[] = [];

  constructor(
    private client: LinearClient,
    private matcher: IssueMatcher
  ) {
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(() => this.schedule()),
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document === vscode.window.activeTextEditor?.document) {
          this.schedule();
        }
      }),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('linearIssues')) {
          this.schedule();
        }
      }),
      client.onDidChangeAuth(() => this.schedule())
    );
    this.schedule();
  }

  schedule(): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => void this.refresh(), DEBOUNCE_MS);
  }

  private enabled(): boolean {
    return vscode.workspace.getConfiguration('linearIssues').get<boolean>('inlineStatus', true);
  }

  private async refresh(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }
    if (!this.enabled() || !(await this.client.hasApiKey())) {
      this.clearEditor(editor);
      return;
    }

    const matches = this.matcher.matchesIn(editor.document);
    const uniqueIds = [...new Set(matches.map((m) => m.identifier))].slice(
      0,
      MAX_UNIQUE_IDS_PER_DOCUMENT
    );

    const issues = new Map<
      string,
      { name: string; color: string } | null
    >();
    await Promise.all(
      uniqueIds.map(async (id) => {
        try {
          const issue = await this.client.getIssue(id);
          issues.set(id, issue ? { name: issue.state.name, color: issue.state.color } : null);
        } catch {
          issues.set(id, null);
        }
      })
    );

    // Group ranges by state so each distinct (name, color) pair maps to one decoration type.
    const byState = new Map<string, { color: string; name: string; ranges: vscode.Range[] }>();
    for (const match of matches) {
      const state = issues.get(match.identifier);
      if (!state) {
        continue;
      }
      const key = `${state.color}|${state.name}`;
      let group = byState.get(key);
      if (!group) {
        group = { color: state.color, name: state.name, ranges: [] };
        byState.set(key, group);
      }
      group.ranges.push(match.range);
    }

    const usedKeys = new Set<string>();
    for (const [key, group] of byState) {
      usedKeys.add(key);
      let type = this.decorationTypes.get(key);
      if (!type) {
        type = vscode.window.createTextEditorDecorationType({
          after: {
            contentText: ` ● ${group.name}`,
            color: group.color,
            fontStyle: 'italic',
            margin: '0 0 0 0.2em',
          },
        });
        this.decorationTypes.set(key, type);
      }
      editor.setDecorations(type, group.ranges);
    }
    // Clear decoration types no longer present in this editor.
    for (const [key, type] of this.decorationTypes) {
      if (!usedKeys.has(key)) {
        editor.setDecorations(type, []);
      }
    }
  }

  private clearEditor(editor: vscode.TextEditor): void {
    for (const type of this.decorationTypes.values()) {
      editor.setDecorations(type, []);
    }
  }

  dispose(): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    for (const type of this.decorationTypes.values()) {
      type.dispose();
    }
    this.decorationTypes.clear();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
