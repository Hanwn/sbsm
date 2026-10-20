import { jsonResponse, errorResponse, readJsonBody } from '../lib/http';
import { requireAuth } from '../lib/auth';
import type { AuthContext, Env, RouteDefinition } from '../lib/context';
import type { VpnGroupRow, VpnGroupSubscriptionRow } from '../models';
import { fetchLinksByIds } from '../db/links';
import { fetchGroupById, fetchGroupSubscription } from '../db/groups';
import { createInClause } from '../lib/utils';
import {
  normalizeExcludeKeywordsInput,
  parseExcludeKeywords,
  resolveSubscriptionLinks,
} from '../lib/subscription';

type GroupResponse = ReturnType<typeof formatGroupResponse>;

function parseTagNames(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((tag) => typeof tag !== 'string')) return null;
  const names = value.map((tag: string) => tag.trim());
  if (names.some((tag) => !tag || tag.length > 64)) return null;
  return [...new Set(names)];
}

async function handleCreateGroup(
  request: Request,
  env: Env,
  _params: Record<string, string>,
  _auth: AuthContext,
): Promise<Response> {
  const body = await readJsonBody<{
    name?: string;
    description?: string;
    linkIds?: string[];
    tagNames?: string[];
    tag?: string | null;
    type?: string;
    subscriptionUrl?: string;
    excludeKeywords?: string[] | string;
  }>(request);
  if (!body) return errorResponse('Invalid JSON payload', 400);

  const name = body.name?.trim();
  if (!name) return errorResponse('`name` is required', 422);

  const requestedType = (body.type ?? 'manual').trim().toLowerCase();
  if (requestedType !== 'manual' && requestedType !== 'subscription') {
    return errorResponse('`type` must be either "manual" or "subscription"', 422);
  }
  if (requestedType === 'subscription' && Array.isArray(body.linkIds) && body.linkIds.length > 0) {
    return errorResponse('Subscription groups cannot include manual linkIds', 422);
  }
  if (body.tagNames !== undefined && requestedType === 'subscription') {
    return errorResponse('Subscription groups cannot include tagNames', 422);
  }
  if (body.tag != null && typeof body.tag !== 'string') {
    return errorResponse('`tag` must be a string', 422);
  }
  const tag = body.tag?.trim() || null;
  if (tag && tag.length > 64) return errorResponse('`tag` must be at most 64 characters', 422);
  if (requestedType === 'manual' && tag)
    return errorResponse('Manual groups cannot have a subscription tag', 422);
  const tagNames = body.tagNames === undefined ? [] : parseTagNames(body.tagNames);
  if (!tagNames)
    return errorResponse('`tagNames` must contain non-empty strings up to 64 characters', 422);
  const subscriptionUrl = body.subscriptionUrl?.trim();
  if (requestedType === 'subscription' && !subscriptionUrl) {
    return errorResponse('`subscriptionUrl` is required for subscription groups', 422);
  }

  const id = crypto.randomUUID();
  const description = body.description?.trim() ?? null;

  const insert = await env.DB.prepare(
    `INSERT INTO vpn_groups (id, name, description, type, tag) VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(id, name, description, requestedType, tag)
    .run();

  if (!insert.success) {
    console.error('Failed to insert vpn_group', insert.error);
    return errorResponse('Failed to create group', 500);
  }

  if (requestedType === 'subscription') {
    const excludeKeywords = normalizeExcludeKeywordsInput(body.excludeKeywords);

    const insertSubscription = await env.DB.prepare(
      `INSERT INTO vpn_group_subscriptions (group_id, subscription_url, exclude_keywords)
       VALUES (?, ?, ?)`,
    )
      .bind(id, subscriptionUrl, JSON.stringify(excludeKeywords))
      .run();

    if (!insertSubscription.success) {
      console.error('Failed to insert vpn_group_subscription', insertSubscription.error);
      return errorResponse('Failed to create subscription group', 500);
    }
  } else {
    const linkIds =
      Array.isArray(body.linkIds) && body.linkIds.length > 0
        ? Array.from(
            new Set(body.linkIds.filter((item) => typeof item === 'string' && item.length)),
          )
        : [];

    if (linkIds.length > 0) {
      const links = await fetchLinksByIds(env, linkIds);
      const foundIds = new Set(links.map((link) => link.id));
      const missing = linkIds.filter((id) => !foundIds.has(id));
      if (missing.length > 0) {
        return errorResponse('Some linkIds were not found', 404, {
          linkIds: missing,
        });
      }

      const statements = linkIds.map((linkId) =>
        env.DB.prepare(
          `INSERT OR IGNORE INTO vpn_group_links (group_id, link_id) VALUES (?, ?)`,
        ).bind(id, linkId),
      );
      if (statements.length > 0) {
        await env.DB.batch(statements);
      }
    }
    if (tagNames.length > 0) {
      await env.DB.batch(
        tagNames.map((tag) =>
          env.DB.prepare(`INSERT INTO vpn_group_tags (group_id, tag) VALUES (?, ?)`).bind(id, tag),
        ),
      );
    }
  }

  const group = await fetchGroupById(env, id);
  if (!group) {
    console.error('Created group not found after insert', { id });
    return errorResponse('Failed to load created group', 500);
  }

  const manualLinkIds =
    group.type === 'manual'
      ? await loadManualGroupLinkIds(env, [id]).then((map) => map.get(id) ?? [])
      : [];
  const manualTagNames = group.type === 'manual' ? tagNames : [];
  const subscription = group.type === 'subscription' ? await fetchGroupSubscription(env, id) : null;

  return jsonResponse(formatGroupResponse(group, manualLinkIds, subscription, manualTagNames), 201);
}

async function handleListGroups(
  request: Request,
  env: Env,
  _params: Record<string, string>,
  _auth: AuthContext,
): Promise<Response> {
  const url = new URL(request.url);
  if (url.searchParams.has('user_id')) {
    console.warn('user_id filter ignored in single-admin mode');
  }

  const { results } = await env.DB.prepare<VpnGroupRow>(
    `SELECT id, name, description, type, tag, created_at, updated_at
       FROM vpn_groups
       ORDER BY created_at DESC`,
  ).all();

  const manualIds = results.filter((group) => group.type === 'manual').map((group) => group.id);
  const manualLinkMap = await loadManualGroupLinkIds(env, manualIds);
  const manualTagMap = await loadManualGroupTagNames(env, manualIds);

  const subscriptionIds = results
    .filter((group) => group.type === 'subscription')
    .map((group) => group.id);
  const subscriptionMap = await loadSubscriptionMap(env, subscriptionIds);

  const payload: GroupResponse[] = results.map((group) => {
    const linkIds = group.type === 'manual' ? (manualLinkMap.get(group.id) ?? []) : [];
    const subscription =
      group.type === 'subscription' ? (subscriptionMap.get(group.id) ?? null) : null;
    return formatGroupResponse(group, linkIds, subscription, manualTagMap.get(group.id) ?? []);
  });

  return jsonResponse(payload);
}

async function handleDeleteGroup(
  _request: Request,
  env: Env,
  params: Record<string, string>,
  _auth: AuthContext,
): Promise<Response> {
  const groupId = params.id;
  if (!groupId) return errorResponse('Missing group id', 400);

  const group = await fetchGroupById(env, groupId);
  if (!group) return errorResponse('Group not found', 404);

  const result = await env.DB.prepare(`DELETE FROM vpn_groups WHERE id = ?`).bind(groupId).run();
  if (!result.success) {
    console.error('Failed to delete vpn_group', result.error);
    return errorResponse('Failed to delete group', 500);
  }

  return jsonResponse({ success: true });
}

async function handleAddGroupLinks(
  request: Request,
  env: Env,
  params: Record<string, string>,
  _auth: AuthContext,
): Promise<Response> {
  const groupId = params.id;
  if (!groupId) return errorResponse('Missing group id', 400);

  const group = await fetchGroupById(env, groupId);
  if (!group) return errorResponse('Group not found', 404);
  if (group.type !== 'manual') {
    return errorResponse('Cannot attach links to a subscription group', 409);
  }

  const body = await readJsonBody<{ linkIds?: string[] }>(request);
  if (!body) return errorResponse('Invalid JSON payload', 400);

  const linkIds =
    Array.isArray(body.linkIds) && body.linkIds.length > 0
      ? Array.from(new Set(body.linkIds.filter((item) => typeof item === 'string' && item.length)))
      : [];
  if (linkIds.length === 0) {
    return errorResponse('`linkIds` must include at least one id', 422);
  }

  const links = await fetchLinksByIds(env, linkIds);
  const foundIds = new Set(links.map((link) => link.id));
  const missing = linkIds.filter((id) => !foundIds.has(id));
  if (missing.length > 0) {
    return errorResponse('Some linkIds were not found', 404, {
      linkIds: missing,
    });
  }

  const statements = linkIds.map((linkId) =>
    env.DB.prepare(`INSERT OR IGNORE INTO vpn_group_links (group_id, link_id) VALUES (?, ?)`).bind(
      groupId,
      linkId,
    ),
  );
  await env.DB.batch(statements);

  return jsonResponse({ success: true });
}

async function handleRemoveGroupLink(
  _request: Request,
  env: Env,
  params: Record<string, string>,
  _auth: AuthContext,
): Promise<Response> {
  const groupId = params.id;
  const linkId = params.linkId;
  if (!groupId || !linkId) return errorResponse('Missing group or link id', 400);

  const group = await fetchGroupById(env, groupId);
  if (!group) return errorResponse('Group not found', 404);
  if (group.type !== 'manual') {
    return errorResponse('Cannot remove links from a subscription group', 409);
  }

  const remove = await env.DB.prepare(
    `DELETE FROM vpn_group_links WHERE group_id = ? AND link_id = ?`,
  )
    .bind(groupId, linkId)
    .run();

  if (!remove.success) {
    console.error('Failed to delete vpn_group_link', remove.error);
    return errorResponse('Failed to remove link from group', 500);
  }

  return jsonResponse({ success: true });
}

async function handleUpdateGroupTags(
  request: Request,
  env: Env,
  params: Record<string, string>,
  _auth: AuthContext,
): Promise<Response> {
  const groupId = params.id;
  if (!groupId) return errorResponse('Missing group id', 400);
  const group = await fetchGroupById(env, groupId);
  if (!group) return errorResponse('Group not found', 404);
  if (group.type !== 'manual')
    return errorResponse('Cannot attach tags to a subscription group', 409);

  const body = await readJsonBody<{ tagNames?: unknown }>(request);
  if (!body) return errorResponse('Invalid JSON payload', 400);
  const tagNames = parseTagNames(body.tagNames);
  if (!tagNames)
    return errorResponse('`tagNames` must contain non-empty strings up to 64 characters', 422);

  const statements = [
    env.DB.prepare(`DELETE FROM vpn_group_tags WHERE group_id = ?`).bind(groupId),
    ...tagNames.map((tag) =>
      env.DB.prepare(`INSERT INTO vpn_group_tags (group_id, tag) VALUES (?, ?)`).bind(groupId, tag),
    ),
  ];
  await env.DB.batch(statements);
  return jsonResponse({ success: true, tag_names: tagNames });
}

async function handleUpdateSubscriptionGroup(
  request: Request,
  env: Env,
  params: Record<string, string>,
  _auth: AuthContext,
): Promise<Response> {
  const groupId = params.id;
  if (!groupId) return errorResponse('Missing group id', 400);

  const group = await fetchGroupById(env, groupId);
  if (!group) return errorResponse('Group not found', 404);
  if (group.type !== 'subscription') {
    return errorResponse('Group is not a subscription group', 409);
  }

  const subscription = await fetchGroupSubscription(env, groupId);
  if (!subscription) {
    return errorResponse('Subscription metadata missing', 500);
  }

  const body = await readJsonBody<{
    name?: string;
    description?: string | null;
    subscriptionUrl?: string;
    tag?: string | null;
    refresh?: boolean;
  }>(request);
  if (!body) return errorResponse('Invalid JSON payload', 400);
  if (body.tag != null && typeof body.tag !== 'string')
    return errorResponse('`tag` must be a string', 422);
  const nextTag = body.tag === undefined ? group.tag : body.tag?.trim() || null;
  if (nextTag && nextTag.length > 64)
    return errorResponse('`tag` must be at most 64 characters', 422);

  const updates: Promise<unknown>[] = [];
  if (body.name !== undefined || body.description !== undefined) {
    const nextName = body.name !== undefined ? (body.name?.trim() ?? '') : group.name;
    if (!nextName) return errorResponse('`name` cannot be empty', 422);
    const nextDescription =
      body.description !== undefined ? (body.description?.trim() ?? null) : group.description;
    updates.push(
      env.DB.prepare(`UPDATE vpn_groups SET name = ?, description = ? WHERE id = ?`)
        .bind(nextName, nextDescription, groupId)
        .run(),
    );
    group.name = nextName;
    group.description = nextDescription;
  }
  if (body.tag !== undefined) {
    updates.push(
      env.DB.prepare(`UPDATE vpn_groups SET tag = ? WHERE id = ?`).bind(nextTag, groupId).run(),
    );
    group.tag = nextTag;
  }

  let shouldForceRefresh = Boolean(body.refresh);

  if (body.subscriptionUrl !== undefined) {
    const nextUrl = body.subscriptionUrl?.trim();
    if (!nextUrl) return errorResponse('`subscriptionUrl` cannot be empty', 422);
    updates.push(
      env.DB.prepare(
        `UPDATE vpn_group_subscriptions SET subscription_url = ?, last_error = NULL WHERE group_id = ?`,
      )
        .bind(nextUrl, groupId)
        .run(),
    );
    subscription.subscription_url = nextUrl;
    shouldForceRefresh = true;
  }

  if (body.excludeKeywords !== undefined) {
    const keywords = normalizeExcludeKeywordsInput(body.excludeKeywords);
    updates.push(
      env.DB.prepare(
        `UPDATE vpn_group_subscriptions SET exclude_keywords = ?, last_error = NULL WHERE group_id = ?`,
      )
        .bind(JSON.stringify(keywords), groupId)
        .run(),
    );
    subscription.exclude_keywords = JSON.stringify(keywords);
    shouldForceRefresh = true;
  }

  if (updates.length > 0) await Promise.all(updates);

  const { metadata } = await resolveSubscriptionLinks(env, groupId, {
    forceRefresh: shouldForceRefresh,
  });
  const latestSubscription = metadata ?? (await fetchGroupSubscription(env, groupId));

  return jsonResponse(formatGroupResponse(group, [], latestSubscription ?? subscription));
}

async function handleRefreshSubscriptionGroup(
  _request: Request,
  env: Env,
  params: Record<string, string>,
  _auth: AuthContext,
): Promise<Response> {
  const groupId = params.id;
  if (!groupId) return errorResponse('Missing group id', 400);

  const group = await fetchGroupById(env, groupId);
  if (!group) return errorResponse('Group not found', 404);
  if (group.type !== 'subscription') {
    return errorResponse('Group is not a subscription group', 409);
  }

  const { metadata } = await resolveSubscriptionLinks(env, groupId, {
    forceRefresh: true,
  });
  const subscription = metadata ?? (await fetchGroupSubscription(env, groupId));
  if (!subscription) return errorResponse('Subscription metadata missing', 500);

  return jsonResponse(formatGroupResponse(group, [], subscription));
}

function formatGroupResponse(
  group: VpnGroupRow,
  linkIds: string[],
  subscription: VpnGroupSubscriptionRow | null,
  tagNames: string[] = [],
) {
  return {
    id: group.id,
    name: group.name,
    description: group.description,
    type: group.type,
    tag: group.tag,
    created_at: group.created_at,
    updated_at: group.updated_at,
    link_ids: linkIds,
    tag_names: tagNames,
    subscription:
      group.type === 'subscription' && subscription
        ? {
            url: subscription.subscription_url,
            cached_node_count: subscription.cached_node_count ?? 0,
            last_fetched_at: subscription.last_fetched_at ?? null,
            last_error: subscription.last_error ?? null,
            exclude_keywords: parseExcludeKeywords(subscription.exclude_keywords),
          }
        : null,
  };
}

async function loadManualGroupLinkIds(
  env: Env,
  groupIds: string[],
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (groupIds.length === 0) return map;
  const { clause, bindings } = createInClause(groupIds);
  const statement = env.DB.prepare<{ group_id: string; link_id: string }>(
    `SELECT group_id, link_id
       FROM vpn_group_links
      WHERE group_id IN ${clause}`,
  ).bind(...bindings);
  const { results } = await statement.all();
  for (const row of results) {
    const list = map.get(row.group_id);
    if (list) list.push(row.link_id);
    else map.set(row.group_id, [row.link_id]);
  }
  return map;
}

async function loadManualGroupTagNames(
  env: Env,
  groupIds: string[],
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (groupIds.length === 0) return map;
  const { clause, bindings } = createInClause(groupIds);
  const { results } = await env.DB.prepare<{ group_id: string; tag: string }>(
    `SELECT group_id, tag FROM vpn_group_tags WHERE group_id IN ${clause} ORDER BY tag`,
  )
    .bind(...bindings)
    .all();
  for (const row of results) {
    const tags = map.get(row.group_id) ?? [];
    tags.push(row.tag);
    map.set(row.group_id, tags);
  }
  return map;
}

async function loadSubscriptionMap(
  env: Env,
  groupIds: string[],
): Promise<Map<string, VpnGroupSubscriptionRow | null>> {
  const map = new Map<string, VpnGroupSubscriptionRow | null>();
  if (groupIds.length === 0) return map;
  const { clause, bindings } = createInClause(groupIds);
  const statement = env.DB.prepare<VpnGroupSubscriptionRow>(
    `SELECT group_id,
            subscription_url,
            cached_payload,
            cached_node_count,
            last_fetched_at,
            last_error,
            exclude_keywords,
            created_at,
            updated_at
       FROM vpn_group_subscriptions
      WHERE group_id IN ${clause}`,
  ).bind(...bindings);
  const { results } = await statement.all();
  for (const row of results) {
    map.set(row.group_id, row);
  }
  for (const groupId of groupIds) {
    if (!map.has(groupId)) {
      map.set(groupId, null);
    }
  }
  return map;
}

export const groupRoutes: RouteDefinition[] = [
  {
    method: 'POST',
    pattern: new URLPattern({ pathname: '/api/groups' }),
    handler: requireAuth(handleCreateGroup),
  },
  {
    method: 'GET',
    pattern: new URLPattern({ pathname: '/api/groups' }),
    handler: requireAuth(handleListGroups),
  },
  {
    method: 'DELETE',
    pattern: new URLPattern({ pathname: '/api/groups/:id' }),
    handler: requireAuth(handleDeleteGroup),
  },
  {
    method: 'POST',
    pattern: new URLPattern({ pathname: '/api/groups/:id/links' }),
    handler: requireAuth(handleAddGroupLinks),
  },
  {
    method: 'DELETE',
    pattern: new URLPattern({ pathname: '/api/groups/:id/links/:linkId' }),
    handler: requireAuth(handleRemoveGroupLink),
  },
  {
    method: 'PUT',
    pattern: new URLPattern({ pathname: '/api/groups/:id/tags' }),
    handler: requireAuth(handleUpdateGroupTags),
  },
  {
    method: 'PUT',
    pattern: new URLPattern({ pathname: '/api/groups/:id/subscription' }),
    handler: requireAuth(handleUpdateSubscriptionGroup),
  },
  {
    method: 'POST',
    pattern: new URLPattern({
      pathname: '/api/groups/:id/subscription/refresh',
    }),
    handler: requireAuth(handleRefreshSubscriptionGroup),
  },
];
