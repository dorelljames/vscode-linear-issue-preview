import * as vscode from 'vscode';
import { Issue, WorkspaceMeta } from './types';

const API_URL = 'https://api.linear.app/graphql';
const SECRET_KEY = 'linearIssues.apiKey';
const NOT_FOUND_TTL_MS = 60_000;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_IMAGE_CACHE_ENTRIES = 40;

const ISSUE_QUERY = `
query IssueByIdentifier($id: String!) {
  issue(id: $id) {
    id
    identifier
    title
    description
    url
    branchName
    priority
    priorityLabel
    state { name color type }
    assignee { displayName avatarUrl }
    labels { nodes { name color } }
    project { name }
    createdAt
    updatedAt
    comments(first: 10) {
      nodes {
        body
        createdAt
        user { displayName }
      }
    }
  }
}`;

const META_QUERY = `
query WorkspaceMeta {
  organization { urlKey }
  teams(first: 250) { nodes { key } }
}`;

interface CacheEntry {
  issue: Issue | null;
  expires: number;
}

export class LinearClient {
  private cache = new Map<string, CacheEntry>();
  private imageCache = new Map<string, string | null>();
  private inflight = new Map<string, Promise<Issue | null>>();
  private meta: WorkspaceMeta | null = null;
  private metaPromise: Promise<WorkspaceMeta | null> | null = null;

  private readonly onDidChangeAuthEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeAuth = this.onDidChangeAuthEmitter.event;

  constructor(private secrets: vscode.SecretStorage) {}

  async getApiKey(): Promise<string | undefined> {
    return this.secrets.get(SECRET_KEY);
  }

  async hasApiKey(): Promise<boolean> {
    return !!(await this.getApiKey());
  }

  async setApiKey(key: string): Promise<void> {
    await this.secrets.store(SECRET_KEY, key.trim());
    this.clearCache();
    this.imageCache.clear();
    this.meta = null;
    this.metaPromise = null;
    this.onDidChangeAuthEmitter.fire();
  }

  async clearApiKey(): Promise<void> {
    await this.secrets.delete(SECRET_KEY);
    this.clearCache();
    this.imageCache.clear();
    this.meta = null;
    this.metaPromise = null;
    this.onDidChangeAuthEmitter.fire();
  }

  clearCache(): void {
    this.cache.clear();
  }

  private ttlMs(): number {
    const seconds = vscode.workspace
      .getConfiguration('linearIssues')
      .get<number>('cacheTtlSeconds', 300);
    return Math.max(10, seconds) * 1000;
  }

  private async gql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const key = await this.getApiKey();
    if (!key) {
      throw new NoApiKeyError();
    }
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: key,
        // Ask Linear to return uploads.linear.app URLs pre-signed (?signature=JWT);
        // unsigned file URLs 401 for everything, including API-key requests.
        'public-file-urls-expire-in': '10080',
      },
      body: JSON.stringify({ query, variables }),
    });
    if (res.status === 401 || res.status === 403) {
      throw new AuthFailedError();
    }
    if (!res.ok) {
      throw new Error(`Linear API returned HTTP ${res.status}`);
    }
    const json = (await res.json()) as {
      data?: T;
      errors?: Array<{ message: string; extensions?: { code?: string } }>;
    };
    if (json.errors?.length) {
      const notFound = json.errors.some(
        (e) =>
          e.extensions?.code === 'ENTITY_NOT_FOUND' ||
          /not found|could not be found/i.test(e.message)
      );
      if (notFound) {
        throw new NotFoundError();
      }
      throw new Error(json.errors[0].message);
    }
    if (!json.data) {
      throw new Error('Linear API returned no data');
    }
    return json.data;
  }

  /** Workspace url key + team keys; cached until the API key changes. */
  async getWorkspaceMeta(): Promise<WorkspaceMeta | null> {
    if (this.meta) {
      return this.meta;
    }
    if (!this.metaPromise) {
      this.metaPromise = (async () => {
        try {
          const data = await this.gql<{
            organization: { urlKey: string };
            teams: { nodes: Array<{ key: string }> };
          }>(META_QUERY);
          this.meta = {
            urlKey: data.organization.urlKey,
            teamKeys: data.teams.nodes.map((t) => t.key),
          };
          return this.meta;
        } catch {
          this.metaPromise = null;
          return null;
        }
      })();
    }
    return this.metaPromise;
  }

  /** Fetch an issue by identifier (e.g. DEV-4513). Returns null when it doesn't exist. */
  async getIssue(identifier: string): Promise<Issue | null> {
    const id = identifier.toUpperCase();
    const cached = this.cache.get(id);
    if (cached && cached.expires > Date.now()) {
      return cached.issue;
    }
    const existing = this.inflight.get(id);
    if (existing) {
      return existing;
    }
    const promise = (async () => {
      try {
        const data = await this.gql<{ issue: Issue }>(ISSUE_QUERY, { id });
        this.cache.set(id, { issue: data.issue, expires: Date.now() + this.ttlMs() });
        return data.issue;
      } catch (err) {
        if (err instanceof NotFoundError) {
          this.cache.set(id, { issue: null, expires: Date.now() + NOT_FOUND_TTL_MS });
          return null;
        }
        throw err;
      } finally {
        this.inflight.delete(id);
      }
    })();
    this.inflight.set(id, promise);
    return promise;
  }

  /**
   * Fetch a Linear-hosted file (uploads.linear.app requires the API key in an
   * Authorization header, so webview <img> tags can't load it directly) and
   * return it as a data: URI. Returns null on any failure.
   */
  async fetchImageAsDataUri(url: string): Promise<string | null> {
    if (this.imageCache.has(url)) {
      return this.imageCache.get(url) ?? null;
    }
    const key = await this.getApiKey();
    if (!key) {
      return null;
    }
    let result: string | null = null;
    try {
      const res = await fetch(url, { headers: { Authorization: key } });
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length <= MAX_IMAGE_BYTES) {
          const type = res.headers.get('content-type') ?? 'image/png';
          result = `data:${type};base64,${buf.toString('base64')}`;
        }
      }
    } catch {
      result = null;
    }
    if (this.imageCache.size >= MAX_IMAGE_CACHE_ENTRIES) {
      const oldest = this.imageCache.keys().next().value;
      if (oldest !== undefined) {
        this.imageCache.delete(oldest);
      }
    }
    this.imageCache.set(url, result);
    return result;
  }

  /** Cache lookup only — used by decorations to avoid firing requests on every keystroke. */
  getCachedIssue(identifier: string): Issue | null | undefined {
    const cached = this.cache.get(identifier.toUpperCase());
    if (cached && cached.expires > Date.now()) {
      return cached.issue;
    }
    return undefined;
  }
}

export class NoApiKeyError extends Error {
  constructor() {
    super('No Linear API key configured');
  }
}

export class AuthFailedError extends Error {
  constructor() {
    super('Linear rejected the API key');
  }
}

export class NotFoundError extends Error {
  constructor() {
    super('Issue not found');
  }
}
