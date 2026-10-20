import { cloneTemplate, type SingBoxConfig } from '../template.ts';

export function parseSelectorTags(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    const values = Array.isArray(parsed) ? parsed : parsed?.tags;
    if (Array.isArray(values)) {
      const tags = values
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter((item) => item.length > 0);
      return Array.from(new Set(tags));
    }
  } catch (error) {
    console.error('Failed to parse selector_tags JSON', error);
  }
  return [];
}

export type SingBoxVersion = '1.12' | '1.13' | '1.14';

export function isSingBoxVersion(value: unknown): value is SingBoxVersion {
  return value === '1.12' || value === '1.13' || value === '1.14';
}

export function parseTemplateVersion(raw: string): SingBoxVersion | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const version = (parsed as { version?: unknown }).version;
      return isSingBoxVersion(version) ? version : null;
    }
  } catch {
    // Legacy selector tags have no version metadata.
  }
  return null;
}

export function serializeTemplateSettings(
  tags: string[],
  rules: SelectorRule[],
  version: SingBoxVersion | null,
): string {
  if (!version && rules.length === 0) return JSON.stringify(tags);
  return JSON.stringify({ version, tags: rules.length ? [] : tags, rules });
}

export interface SelectorRule {
  outbound: string;
  nodes: string;
}

export function parseSelectorRules(raw: string): SelectorRule[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
    const rules = (parsed as { rules?: unknown }).rules;
    if (!Array.isArray(rules)) return [];
    return rules.filter((rule): rule is SelectorRule =>
      Boolean(rule && typeof rule === 'object' &&
        typeof rule.outbound === 'string' && typeof rule.nodes === 'string'),
    );
  } catch {
    return [];
  }
}

export function validateSelectorRules(value: unknown): SelectorRule[] | null {
  if (!Array.isArray(value) || value.length > 100) return null;
  const rules: SelectorRule[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') return null;
    const { outbound, nodes } = item as Record<string, unknown>;
    if (typeof outbound !== 'string' || typeof nodes !== 'string' ||
        !outbound.trim() || outbound.length > 500 || nodes.length > 500) return null;
    try {
      new RegExp(outbound);
      new RegExp(nodes);
    } catch {
      return null;
    }
    rules.push({ outbound: outbound.trim(), nodes: nodes.trim() });
  }
  return rules;
}

export function parseBaseConfig(raw: string): SingBoxConfig {
  try {
    const parsed = JSON.parse(raw) as SingBoxConfig;
    if (parsed && typeof parsed === 'object') {
      if (!Array.isArray(parsed.outbounds)) parsed.outbounds = [];
      return parsed;
    }
  } catch (error) {
    console.error('Failed to parse base_config JSON', error);
  }
  const fallback = cloneTemplate();
  fallback.outbounds = [];
  return fallback;
}

export function normalizeConfigInput(input: unknown): SingBoxConfig {
  if (typeof input === 'string') {
    return parseBaseConfig(input);
  }
  if (input && typeof input === 'object') {
    const cloned = JSON.parse(JSON.stringify(input)) as SingBoxConfig;
    if (!cloned.outbounds || !Array.isArray(cloned.outbounds)) {
      cloned.outbounds = [];
    }
    return cloned;
  }
  return cloneTemplate();
}

export function stringifyConfig(config: SingBoxConfig): string {
  return JSON.stringify(config);
}

export function mergeGeneratedOutbounds(
  config: SingBoxConfig,
  generated: unknown[],
  selectorTags: string[],
  selectorRules: SelectorRule[] = [],
): void {
  if (!Array.isArray(config.outbounds)) {
    config.outbounds = [];
  }
  config.outbounds.push(...generated);

  const newTags = generated
    .map((item) =>
      item && typeof item === 'object' ? (item as any).tag : undefined,
    )
    .filter((tag): tag is string => typeof tag === 'string' && tag.length > 0);
  for (const outbound of config.outbounds) {
    if (!outbound || typeof outbound !== 'object') continue;
    const tag = (outbound as any).tag;
    if (typeof tag !== 'string') continue;
    // A template group with members is already configured by the user.
    if (Array.isArray((outbound as any).outbounds) && (outbound as any).outbounds.length > 0) continue;
    if (selectorRules.length > 0) {
      if ((outbound as any).type !== 'selector' && (outbound as any).type !== 'urltest') continue;
      const applicableRules = selectorRules.filter((rule) => new RegExp(rule.outbound, 'i').test(tag));
      if (applicableRules.length === 0) continue;
      const matchingTags = applicableRules.flatMap((rule) => {
        const nodePattern = new RegExp(rule.nodes, 'i');
        return newTags.filter((nodeTag) => nodePattern.test(nodeTag));
      });
      const target = (outbound as any).outbounds;
      if (!Array.isArray(target)) (outbound as any).outbounds = [];
      appendUniqueStrings((outbound as any).outbounds as string[], matchingTags);
      continue;
    }
    if (!selectorTags.includes(tag)) continue;

    const target = (outbound as any).outbounds;
    if (!Array.isArray(target)) {
      (outbound as any).outbounds = [...newTags];
      continue;
    }
    appendUniqueStrings(target as string[], newTags);
  }
  let fallbackNeeded = false;
  for (const outbound of config.outbounds) {
    if (!outbound || typeof outbound !== 'object') continue;
    const group = outbound as { type?: string; outbounds?: unknown[] };
    if (group.type !== 'selector' && group.type !== 'urltest') continue;
    if (Array.isArray(group.outbounds) && group.outbounds.length > 0) continue;
    group.outbounds = ['COMPATIBLE'];
    fallbackNeeded = true;
  }
  if (fallbackNeeded) {
    const compatibleIndex = config.outbounds.findIndex((item) =>
      item && typeof item === 'object' && (item as any).tag === 'COMPATIBLE');
    if (compatibleIndex === -1) {
      config.outbounds.push({ tag: 'COMPATIBLE', type: 'direct' });
    } else if ((config.outbounds[compatibleIndex] as any).type !== 'direct') {
      config.outbounds[compatibleIndex] = { tag: 'COMPATIBLE', type: 'direct' };
    }
  }
}

export function appendUniqueStrings(target: string[], values: string[]): void {
  const seen = new Set<string>(
    target.filter((item) => typeof item === 'string'),
  );
  for (const value of values) {
    if (!seen.has(value)) {
      target.push(value);
      seen.add(value);
    }
  }
}
