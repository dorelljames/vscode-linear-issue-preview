import * as vscode from 'vscode';
import { LinearClient } from './linearClient';
import { IssueMatcher } from './issueRegex';

/** Makes issue keys Cmd+Click-able, linking straight to the issue in Linear. */
export class IssueLinkProvider implements vscode.DocumentLinkProvider {
  constructor(
    private client: LinearClient,
    private matcher: IssueMatcher
  ) {}

  async provideDocumentLinks(
    document: vscode.TextDocument
  ): Promise<vscode.DocumentLink[]> {
    const meta = await this.client.getWorkspaceMeta();
    if (!meta) {
      return [];
    }
    return this.matcher.matchesIn(document).map((match) => {
      const link = new vscode.DocumentLink(
        match.range,
        vscode.Uri.parse(`https://linear.app/${meta.urlKey}/issue/${match.identifier}`)
      );
      link.tooltip = `Open ${match.identifier} in Linear`;
      return link;
    });
  }
}
