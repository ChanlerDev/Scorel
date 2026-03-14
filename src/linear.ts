import { SymphonyError } from "./errors.js";
import type { Issue, IssueBlockerRef, TrackerClient, TrackerConfig } from "./types.js";

const PAGE_SIZE = 50;

const ISSUE_FIELDS = `
  id
  identifier
  title
  description
  priority
  branchName
  url
  createdAt
  updatedAt
  state { name }
  labels { nodes { name } }
  inverseRelations(first: 50) {
    nodes {
      type
      issue {
        id
        identifier
        state { name }
      }
    }
  }
`;

const CANDIDATE_QUERY = `
  query SymphonyLinearPoll($projectSlug: String!, $stateNames: [String!]!, $first: Int!, $after: String) {
    issues(
      filter: {
        project: { slugId: { eq: $projectSlug } }
        state: { name: { in: $stateNames } }
      }
      first: $first
      after: $after
    ) {
      nodes {
        ${ISSUE_FIELDS}
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

const ISSUES_BY_STATES_QUERY = CANDIDATE_QUERY;

const ISSUES_BY_IDS_QUERY = `
  query SymphonyLinearIssuesByIds($ids: [ID!]!, $first: Int!) {
    issues(filter: { id: { in: $ids } }, first: $first) {
      nodes {
        ${ISSUE_FIELDS}
      }
    }
  }
`;

export class LinearTrackerClient implements TrackerClient {
  constructor(private readonly config: TrackerConfig) {}

  async fetchCandidateIssues(): Promise<Issue[]> {
    return this.fetchIssuesByStates(this.config.activeStates);
  }

  async fetchIssuesByStates(states: string[]): Promise<Issue[]> {
    if (states.length === 0) {
      return [];
    }

    this.ensureConfigured();
    const issues: Issue[] = [];
    let after: string | null = null;

    while (true) {
      const data: {
        issues: {
          nodes: unknown[];
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
        };
      } = await this.graphql(ISSUES_BY_STATES_QUERY, {
        projectSlug: this.config.projectSlug,
        stateNames: states,
        first: PAGE_SIZE,
        after
      });

      issues.push(...data.issues.nodes.map((node: unknown) => normalizeIssue(node)));

      if (!data.issues.pageInfo.hasNextPage) {
        return issues;
      }

      if (!data.issues.pageInfo.endCursor) {
        throw new SymphonyError("linear_missing_end_cursor", "Linear response is missing endCursor");
      }

      after = data.issues.pageInfo.endCursor;
    }
  }

  async fetchIssueStatesByIds(issueIds: string[]): Promise<Issue[]> {
    if (issueIds.length === 0) {
      return [];
    }

    this.ensureConfigured();
    const issues: Issue[] = [];

    for (let index = 0; index < issueIds.length; index += PAGE_SIZE) {
      const batch = issueIds.slice(index, index + PAGE_SIZE);
      const data: { issues: { nodes: unknown[] } } = await this.graphql(ISSUES_BY_IDS_QUERY, {
        ids: batch,
        first: batch.length
      });

      issues.push(...data.issues.nodes.map((node: unknown) => normalizeIssue(node)));
    }

    const order = new Map(issueIds.map((id, index) => [id, index]));
    return issues.sort((left, right) => (order.get(left.id) ?? 0) - (order.get(right.id) ?? 0));
  }

  private ensureConfigured(): void {
    if (!this.config.apiKey) {
      throw new SymphonyError("missing_tracker_api_key", "Missing Linear API key");
    }
    if (!this.config.projectSlug) {
      throw new SymphonyError("missing_tracker_project_slug", "Missing Linear project slug");
    }
  }

  private async graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const response = await fetch(this.config.endpoint, {
      method: "POST",
      headers: {
        Authorization: this.config.apiKey ?? "",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        query,
        variables
      })
    }).catch((error) => {
      throw new SymphonyError("linear_api_request", "Failed to reach Linear API", error);
    });

    if (!response.ok) {
      throw new SymphonyError("linear_api_status", `Linear API returned status ${response.status}`);
    }

    const payload = (await response.json()) as { data?: T; errors?: unknown };
    if (payload.errors) {
      throw new SymphonyError("linear_graphql_errors", "Linear returned GraphQL errors", payload.errors);
    }

    if (!payload.data) {
      throw new SymphonyError("linear_unknown_payload", "Linear payload is missing data");
    }

    return payload.data;
  }
}

export function normalizeIssue(input: unknown): Issue {
  const issue = objectValue(input);
  const state = objectValue(issue.state);

  return {
    id: String(issue.id ?? ""),
    identifier: String(issue.identifier ?? ""),
    title: String(issue.title ?? ""),
    description: stringOrNull(issue.description),
    priority: typeof issue.priority === "number" && Number.isInteger(issue.priority) ? issue.priority : null,
    state: String(state.name ?? ""),
    branch_name: stringOrNull(issue.branchName),
    url: stringOrNull(issue.url),
    labels: normalizeLabels(issue.labels),
    blocked_by: normalizeBlockers(issue.inverseRelations),
    created_at: parseDate(issue.createdAt),
    updated_at: parseDate(issue.updatedAt)
  };
}

function normalizeLabels(input: unknown): string[] {
  const labels = objectValue(input).nodes;
  if (!Array.isArray(labels)) {
    return [];
  }

  return labels
    .map((label) => stringOrNull(objectValue(label).name))
    .filter((label): label is string => Boolean(label))
    .map((label) => label.toLowerCase());
}

function normalizeBlockers(input: unknown): IssueBlockerRef[] {
  const relations = objectValue(input).nodes;
  if (!Array.isArray(relations)) {
    return [];
  }

  return relations.flatMap((relation) => {
    const normalized = objectValue(relation);
    if (String(normalized.type ?? "").trim().toLowerCase() !== "blocks") {
      return [];
    }

    const issue = objectValue(normalized.issue);
    const state = objectValue(issue.state);
    return [
      {
        id: stringOrNull(issue.id),
        identifier: stringOrNull(issue.identifier),
        state: stringOrNull(state.name)
      }
    ];
  });
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== "string") {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function objectValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}
