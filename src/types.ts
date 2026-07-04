export interface IssueLabel {
  name: string;
  color: string;
}

export interface IssueComment {
  body: string;
  createdAt: string;
  user: { displayName: string } | null;
}

export interface Issue {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  url: string;
  branchName: string;
  priority: number;
  priorityLabel: string;
  state: { name: string; color: string; type: StateType };
  assignee: { displayName: string; avatarUrl: string | null } | null;
  labels: { nodes: IssueLabel[] };
  project: { name: string } | null;
  createdAt: string;
  updatedAt: string;
  comments: { nodes: IssueComment[] };
}

export type StateType =
  | 'triage'
  | 'backlog'
  | 'unstarted'
  | 'started'
  | 'completed'
  | 'canceled';

export interface WorkspaceMeta {
  urlKey: string;
  teamKeys: string[];
}
