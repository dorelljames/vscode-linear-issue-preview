import * as vscode from 'vscode';
import { LinearClient, AuthFailedError } from './linearClient';
import { IssueMatcher } from './issueRegex';
import { IssueHoverProvider } from './hover';
import { IssueLinkProvider } from './links';
import { StatusDecorations } from './decorations';
import { IssueDetailsPanel } from './detailsPanel';

const SELECTOR: vscode.DocumentSelector = [
  { scheme: 'file' },
  { scheme: 'untitled' },
  { scheme: 'vscode-scm' },
];

export function activate(context: vscode.ExtensionContext): void {
  const client = new LinearClient(context.secrets);
  const matcher = new IssueMatcher(client);

  context.subscriptions.push(
    vscode.languages.registerHoverProvider(SELECTOR, new IssueHoverProvider(client, matcher)),
    vscode.languages.registerDocumentLinkProvider(SELECTOR, new IssueLinkProvider(client, matcher)),
    new StatusDecorations(client, matcher),

    vscode.commands.registerCommand('linearIssues.setApiKey', async () => {
      const key = await vscode.window.showInputBox({
        title: 'Linear API Key',
        prompt:
          'Create a personal API key in Linear: Settings → Security & access → Personal API keys',
        password: true,
        ignoreFocusOut: true,
        placeHolder: 'lin_api_...',
      });
      if (!key) {
        return;
      }
      await client.setApiKey(key);
      const meta = await client.getWorkspaceMeta();
      if (meta) {
        await matcher.refreshTeamKeys();
        void vscode.window.showInformationMessage(
          `Linear connected: workspace "${meta.urlKey}" with ${meta.teamKeys.length} team(s).`
        );
      } else {
        void vscode.window.showErrorMessage(
          'Could not reach Linear with that API key. Check the key and try again.'
        );
      }
    }),

    vscode.commands.registerCommand('linearIssues.clearApiKey', async () => {
      await client.clearApiKey();
      void vscode.window.showInformationMessage('Linear API key removed.');
    }),

    vscode.commands.registerCommand('linearIssues.refresh', () => {
      client.clearCache();
      void matcher.refreshTeamKeys();
      void vscode.window.showInformationMessage('Linear issue cache cleared.');
    }),

    vscode.commands.registerCommand('linearIssues.showDetails', async (identifier?: string) => {
      if (!identifier) {
        identifier = await vscode.window.showInputBox({
          title: 'Open Linear Issue',
          prompt: 'Issue identifier, e.g. DEV-4513',
          validateInput: (v) =>
            /^[A-Za-z][A-Za-z0-9]{0,9}-\d{1,7}$/.test(v.trim()) ? undefined : 'Expected e.g. DEV-4513',
        });
        if (!identifier) {
          return;
        }
      }
      try {
        await IssueDetailsPanel.show(client, identifier.trim().toUpperCase());
      } catch (err) {
        handleError(err);
      }
    }),

    vscode.commands.registerCommand('linearIssues.copyBranchName', async (identifier: string) => {
      try {
        const issue = await client.getIssue(identifier);
        if (!issue) {
          void vscode.window.showWarningMessage(`Issue ${identifier} not found.`);
          return;
        }
        await vscode.env.clipboard.writeText(issue.branchName);
        void vscode.window.showInformationMessage(`Copied branch name: ${issue.branchName}`);
      } catch (err) {
        handleError(err);
      }
    })
  );

  // First-run nudge: offer to connect if no key is stored yet.
  void client.hasApiKey().then(async (has) => {
    if (has || context.globalState.get('linearIssues.promptedForKey')) {
      return;
    }
    await context.globalState.update('linearIssues.promptedForKey', true);
    const choice = await vscode.window.showInformationMessage(
      'Linear Inline Issues: connect your Linear workspace to see issue details on hover.',
      'Set API Key'
    );
    if (choice === 'Set API Key') {
      void vscode.commands.executeCommand('linearIssues.setApiKey');
    }
  });
}

function handleError(err: unknown): void {
  if (err instanceof AuthFailedError) {
    void vscode.window
      .showErrorMessage('Linear rejected your API key.', 'Set API Key')
      .then((choice) => {
        if (choice === 'Set API Key') {
          void vscode.commands.executeCommand('linearIssues.setApiKey');
        }
      });
    return;
  }
  void vscode.window.showErrorMessage(
    `Linear: ${err instanceof Error ? err.message : String(err)}`
  );
}

export function deactivate(): void {}
