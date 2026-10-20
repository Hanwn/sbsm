import type { VpnLinkRow } from './models';

type Outbound = Record<string, unknown>;

interface ParsedLinkBase {
  type: string;
  name: string;
}

interface ParsedVlessLink extends ParsedLinkBase {
  type: 'vless';
  server: string;
  port: number;
  uuid: string;
  params: URLSearchParams;
}

interface ParsedVmessLink extends ParsedLinkBase {
  type: 'vmess';
  server: string;
  port: number;
  uuid: string;
  alterId: number;
  cipher: string;
  network: string;
  security: string;
  tls: boolean;
  host?: string;
  path?: string;
  sni?: string;
  alpn?: string[];
}

interface ParsedTrojanLink extends ParsedLinkBase {
  type: 'trojan';
  server: string;
  port: number;
  password: string;
  params: URLSearchParams;
}

interface ParsedSSLink extends ParsedLinkBase {
  type: 'ss';
  server: string;
  port: number;
  cipher: string;
  password: string;
  plugin?: {
    name: string;
    options?: Record<string, string>;
  };
}

interface ParsedTuicLink extends ParsedLinkBase {
  type: 'tuic';
  url: URL;
  uuid: string;
  password: string;
}

interface ParsedHysteria2Link extends ParsedLinkBase {
  type: 'hysteria2';
  url: URL;
  password: string;
}

interface ParsedAnyTlsLink extends ParsedLinkBase {
  type: 'anytls';
  url: URL;
  password: string;
}

type ParsedLink =
  | ParsedVlessLink
  | ParsedVmessLink
  | ParsedTrojanLink
  | ParsedSSLink
  | ParsedTuicLink
  | ParsedHysteria2Link
  | ParsedAnyTlsLink;

export async function convertLinksToOutbounds(
  links: VpnLinkRow[],
): Promise<Outbound[]> {
  const tagUsage = new Map<string, number>();
  const outbounds: Outbound[] = [];

  for (const link of links) {
    const raw = link.raw_link.trim();
    if (!raw) continue;

    try {
      const parsed = parseVpnLink(
        raw,
        link.name || `node-${outbounds.length + 1}`,
      );
      const tag = ensureUniqueTag(parsed.name, tagUsage);
      const outbound = linkToOutbound(parsed, tag);
      if (Array.isArray(outbound)) {
        outbound.forEach((item) => outbounds.push(item));
      } else if (outbound) {
        outbounds.push(outbound);
      }
    } catch (error) {
      console.error('convertLinksToOutbounds error', {
        linkId: link.id,
        message: (error as Error).message,
      });
    }
  }

  return outbounds;
}

function parseVpnLink(raw: string, name: string): ParsedLink {
  if (raw.startsWith('vless://')) return parseVless(raw, name);
  if (raw.startsWith('vmess://')) return parseVmess(raw, name);
  if (raw.startsWith('trojan://')) return parseTrojan(raw, name);
  if (raw.startsWith('ss://')) return parseShadowsocks(raw, name);
  if (raw.startsWith('tuic://')) return parseTuic(raw, name);
  if (raw.startsWith('hysteria2://') || raw.startsWith('hy2://'))
    return parseHysteria2(raw, name);
  if (raw.startsWith('anytls://')) return parseAnyTls(raw, name);

  throw new Error(`Unsupported protocol in link: ${raw.slice(0, 16)}…`);
}

function linkToOutbound(
  parsed: ParsedLink,
  tag: string,
): Outbound | Outbound[] {
  switch (parsed.type) {
    case 'vless':
      return vlessToOutbound(parsed, tag);
    case 'vmess':
      return vmessToOutbound(parsed, tag);
    case 'trojan':
      return trojanToOutbound(parsed, tag);
    case 'ss':
      return shadowsocksToOutbound(parsed, tag);
    case 'tuic':
      return tuicToOutbound(parsed, tag);
    case 'hysteria2':
      return hysteria2ToOutbound(parsed, tag);
    case 'anytls':
      return anyTlsToOutbound(parsed, tag);
    default:
      throw new Error(
        `Unsupported parsed type: ${(parsed as ParsedLinkBase).type}`,
      );
  }
}

function parseTuic(raw: string, name: string): ParsedTuicLink {
  const url = new URL(raw);
  requireServer(url);
  const uuid = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  if (!uuid || !password)
    throw new Error('TUIC link requires UUID and password');
  return { type: 'tuic', name, url, uuid, password };
}

function parseHysteria2(raw: string, name: string): ParsedHysteria2Link {
  const url = new URL(raw);
  requireServer(url);
  const password = decodeUrlCredential(url);
  if (!password) throw new Error('Hysteria2 link requires password');
  return { type: 'hysteria2', name, url, password };
}

function parseAnyTls(raw: string, name: string): ParsedAnyTlsLink {
  const url = new URL(raw);
  requireServer(url);
  const password = decodeUrlCredential(url);
  if (!password) throw new Error('AnyTLS link requires password');
  return { type: 'anytls', name, url, password };
}

function requireServer(url: URL): void {
  if (!url.hostname) throw new Error('Missing server hostname');
  if (!url.port) throw new Error('Missing server port');
}

function serverHostname(url: URL): string {
  return url.hostname.replace(/^\[|\]$/g, '');
}

function decodeUrlCredential(url: URL): string {
  const encoded = url.password
    ? `${url.username}:${url.password}`
    : url.username;
  return decodeURIComponent(encoded);
}

function parseVless(raw: string, name: string): ParsedVlessLink {
  const url = new URL(raw);
  if (!url.hostname) throw new Error('Missing server hostname');

  const port = url.port ? parseInt(url.port, 10) : 443;
  if (Number.isNaN(port)) throw new Error('Invalid port');

  const uuid = decodeURIComponent(url.username);
  if (!uuid) throw new Error('Missing UUID in VLESS link');

  return {
    type: 'vless',
    name,
    server: url.hostname,
    port,
    uuid,
    params: url.searchParams,
  };
}

function parseVmess(raw: string, name: string): ParsedVmessLink {
  const payload = raw.slice('vmess://'.length);
  const decoded = decodeBase64String(payload.trim());
  const data = JSON.parse(decoded) as Record<string, unknown>;

  const server = String(data.add ?? data.address ?? '');
  const port = parseInt(String(data.port ?? '0'), 10);
  const uuid = String(data.id ?? '');
  if (!server || !port || !uuid)
    throw new Error('Missing required vmess fields (server/port/id)');

  const network = String(data.net ?? 'tcp');
  const cipher = String(data.type ?? 'auto');
  const tls = String(data.tls ?? '').toLowerCase() === 'tls';
  const security = String(data.scy ?? data.security ?? 'auto');
  const alpn = typeof data.alpn === 'string' ? data.alpn.split(',') : undefined;

  return {
    type: 'vmess',
    name,
    server,
    port,
    uuid,
    alterId: parseInt(String(data.aid ?? data.alterId ?? '0'), 10) || 0,
    cipher,
    network,
    tls,
    security,
    host: data.host ? String(data.host) : undefined,
    path: data.path ? String(data.path) : undefined,
    sni: data.sni ? String(data.sni) : undefined,
    alpn,
  };
}

function parseTrojan(raw: string, name: string): ParsedTrojanLink {
  const url = new URL(raw);
  if (!url.hostname) throw new Error('Missing trojan host');
  const password = decodeURIComponent(url.username || url.password || '');
  if (!password) throw new Error('Missing trojan password');
  const port = url.port ? parseInt(url.port, 10) : 443;
  if (Number.isNaN(port)) throw new Error('Invalid trojan port');
  return {
    type: 'trojan',
    name,
    server: url.hostname,
    port,
    password,
    params: url.searchParams,
  };
}

function parseShadowsocks(raw: string, name: string): ParsedSSLink {
  const withoutScheme = raw.slice('ss://'.length);
  const [credentialPart] = withoutScheme.split('#', 2);

  const [mainPart, queryString = ''] = credentialPart.split('?', 2);
  let credentials = mainPart;

  if (!mainPart.includes('@')) {
    credentials = decodeBase64String(mainPart);
  }

  const atIndex = credentials.lastIndexOf('@');
  if (atIndex === -1) throw new Error('Invalid shadowsocks credential format');

  let methodAndPassword = credentials.slice(0, atIndex);
  const serverAndPort = credentials.slice(atIndex + 1);

  if (!methodAndPassword.includes(':')) {
    methodAndPassword = decodeBase64String(methodAndPassword);
  }

  const [method, password] = methodAndPassword.split(':', 2);
  const [server, portStr] = serverAndPort.split(':', 2);

  if (!method || !password || !server || !portStr) {
    throw new Error('Incomplete shadowsocks credentials');
  }

  const port = parseInt(portStr, 10);
  if (Number.isNaN(port)) throw new Error('Invalid shadowsocks port');

  const params = new URLSearchParams(queryString);
  let plugin: ParsedSSLink['plugin'];
  if (params.has('plugin')) {
    const pluginRaw = params.get('plugin') ?? '';
    const [pluginName, pluginOptsStr] = pluginRaw.split(';', 2);
    const options: Record<string, string> = {};
    if (pluginOptsStr) {
      for (const opt of pluginOptsStr.split(';')) {
        const [k, v] = opt.split('=', 2);
        if (k && v) options[k] = v;
      }
    }
    plugin = { name: pluginName, options };
  }

  return {
    type: 'ss',
    name,
    server,
    port,
    cipher: method,
    password,
    plugin,
  };
}

function vlessToOutbound(parsed: ParsedVlessLink, tag: string): Outbound {
  const params = parsed.params;
  const network = params.get('type') ?? params.get('network') ?? 'tcp';
  const security = params.get('security') ?? '';
  const flow = params.get('flow') ?? undefined;
  const grpcServiceName =
    params.get('serviceName') ?? params.get('service_name');
  const sni =
    params.get('sni') ??
    params.get('serverName') ??
    params.get('host') ??
    undefined;
  const fp = params.get('fp') ?? params.get('fingerprint') ?? undefined;
  const alpn =
    params
      .get('alpn')
      ?.split(',')
      .map((s) => s.trim())
      .filter(Boolean) ?? undefined;
  const pbk = params.get('pbk') ?? params.get('publicKey') ?? undefined;
  const sid = params.get('sid') ?? params.get('shortId') ?? undefined;
  const spx = normalizeSpiderX(params.get('spx'));
  const packetEncoding =
    params.get('packetEncoding') ??
    params.get('packet_encoding') ??
    params.get('packetencoding') ??
    undefined;

  const outbound: Outbound = {
    tag,
    type: 'vless',
    server: parsed.server,
    server_port: parsed.port,
    uuid: parsed.uuid,
  };

  if (flow) outbound.flow = flow;

  const tlsEnabled = security && security !== 'none';
  if (tlsEnabled || sni || fp || pbk || sid) {
    const tls: Record<string, unknown> = {
      enabled: true,
      server_name: sni ?? parsed.server,
      insecure: parseBooleanParam(params.get('allowInsecure')),
    };

    if (security === 'reality') {
      tls.reality = dropUndefined({
        enabled: true,
        public_key: pbk,
        short_id: sid,
        spider_x: spx,
      });
      tls.utls = dropUndefined({
        enabled: !!fp,
        fingerprint: fp,
      });
    } else {
      if (fp) {
        tls.utls = {
          enabled: true,
          fingerprint: fp,
        };
      }
    }

    if (alpn?.length) {
      tls.alpn = alpn;
    }

    outbound.tls = tls;
  }

  switch (network) {
    case 'ws': {
      const headers: Record<string, string> = {};
      const host = params.get('host') ?? params.get('ws-headers') ?? undefined;
      if (host) headers.Host = host;
      const path = params.get('path') ?? params.get('ws-path') ?? '/';
      outbound.transport = dropUndefined({
        type: params.get('ws-opts') === 'http' ? 'http' : 'ws',
        path,
        headers: Object.keys(headers).length ? headers : undefined,
        early_data_header_name: params.get('ed') ?? undefined,
        max_early_data: params.get('ed')
          ? parseInt(params.get('ed')!, 10)
          : undefined,
      });
      break;
    }
    case 'grpc': {
      outbound.transport = {
        type: 'grpc',
        service_name: grpcServiceName ?? 'grpc',
      };
      break;
    }
    case 'http':
    case 'h2': {
      const path = params.get('path') ?? '/';
      const host = params.get('host');
      const method = params.get('method') ?? undefined;
      const transport: Record<string, unknown> = {
        type: 'http',
        path,
      };
      if (host) transport.host = host.includes(',') ? host.split(',') : host;
      if (method) transport.method = method;
      outbound.transport = transport;
      break;
    }
    default:
      break;
  }

  if (packetEncoding) {
    outbound.packet_encoding = packetEncoding;
  }

  return outbound;
}

function vmessToOutbound(parsed: ParsedVmessLink, tag: string): Outbound {
  const outbound: Outbound = {
    tag,
    type: 'vmess',
    server: parsed.server,
    server_port: parsed.port,
    uuid: parsed.uuid,
    security: parsed.security || 'auto',
    alter_id: parsed.alterId,
    tls: {
      enabled: parsed.tls,
      server_name: parsed.sni ?? parsed.server,
      insecure: false,
    },
  };

  if (!parsed.tls) delete outbound.tls;
  if (parsed.tls && parsed.alpn?.length) {
    (outbound.tls as Record<string, unknown>).alpn = parsed.alpn;
  }

  switch (parsed.network) {
    case 'ws':
      outbound.transport = dropUndefined({
        type: 'ws',
        path: parsed.path ?? '/',
        headers: parsed.host ? { Host: parsed.host } : undefined,
      });
      break;
    case 'grpc':
      outbound.transport = {
        type: 'grpc',
        service_name: parsed.path ?? 'grpc',
      };
      break;
    case 'http':
    case 'h2':
      outbound.transport = dropUndefined({
        type: 'http',
        path: parsed.path ?? '/',
        host: parsed.host ? parsed.host.split(',') : undefined,
      });
      break;
    default:
      break;
  }

  return outbound;
}

function trojanToOutbound(parsed: ParsedTrojanLink, tag: string): Outbound {
  const params = parsed.params;
  const network = params.get('type') ?? params.get('network') ?? 'tcp';
  const sni = params.get('sni') ?? params.get('host') ?? undefined;
  const fp = params.get('fp') ?? undefined;

  const outbound: Outbound = {
    tag,
    type: 'trojan',
    server: parsed.server,
    server_port: parsed.port,
    password: parsed.password,
    tls: dropUndefined({
      enabled: true,
      server_name: sni ?? parsed.server,
      insecure: parseBooleanParam(params.get('allowInsecure')),
      utls: fp ? { enabled: true, fingerprint: fp } : undefined,
    }),
  };

  switch (network) {
    case 'ws': {
      const path = params.get('path') ?? '/';
      const host = params.get('host');
      outbound.transport = dropUndefined({
        type: 'ws',
        path,
        headers: host ? { Host: host } : undefined,
      });
      break;
    }
    case 'grpc': {
      outbound.transport = {
        type: 'grpc',
        service_name: params.get('serviceName') ?? 'grpc',
      };
      break;
    }
    case 'http':
    case 'h2': {
      const host = params.get('host');
      outbound.transport = dropUndefined({
        type: 'http',
        path: params.get('path') ?? '/',
        host: host ? host.split(',') : undefined,
      });
      break;
    }
    default:
      break;
  }

  return outbound;
}

function shadowsocksToOutbound(
  parsed: ParsedSSLink,
  tag: string,
): Outbound | Outbound[] {
  const outbound: Outbound = {
    tag,
    type: 'shadowsocks',
    server: parsed.server,
    server_port: parsed.port,
    method: parsed.cipher,
    password: parsed.password,
  };

  if (parsed.plugin) {
    outbound.plugin = parsed.plugin.name;
    if (parsed.plugin.options && Object.keys(parsed.plugin.options).length) {
      const opts: string[] = [];
      for (const [key, value] of Object.entries(parsed.plugin.options)) {
        opts.push(`${key}=${value}`);
      }
      outbound.plugin_opts = opts.join(';');
    }
  }

  return outbound;
}

function tuicToOutbound(parsed: ParsedTuicLink, tag: string): Outbound {
  const params = parsed.url.searchParams;
  return dropUndefined({
    type: 'tuic',
    tag,
    server: serverHostname(parsed.url),
    server_port: Number(parsed.url.port),
    uuid: parsed.uuid,
    password: parsed.password,
    congestion_control: firstParam(
      params,
      'congestion_control',
      'congestion-control',
      'congestionControl',
    ),
    udp_relay_mode: firstParam(params, 'udp_relay_mode', 'udp-relay-mode'),
    zero_rtt_handshake: optionalBooleanParam(
      params,
      'zero_rtt_handshake',
      'zero-rtt-handshake',
    ),
    tls: linkTls(params, serverHostname(parsed.url)),
  });
}

function hysteria2ToOutbound(
  parsed: ParsedHysteria2Link,
  tag: string,
): Outbound {
  const params = parsed.url.searchParams;
  const obfsType = firstParam(params, 'obfs');
  const obfsPassword = firstParam(params, 'obfs-password', 'obfs_password');
  if (obfsType && obfsType !== 'salamander') {
    throw new Error(`Unsupported Hysteria2 obfuscation: ${obfsType}`);
  }
  if (obfsType && !obfsPassword) {
    throw new Error('Hysteria2 salamander obfuscation requires a password');
  }

  return dropUndefined({
    type: 'hysteria2',
    tag,
    server: serverHostname(parsed.url),
    server_port: Number(parsed.url.port),
    password: parsed.password,
    up_mbps: optionalPositiveNumber(params, 'upmbps', 'up_mbps'),
    down_mbps: optionalPositiveNumber(params, 'downmbps', 'down_mbps'),
    obfs: obfsType ? { type: obfsType, password: obfsPassword } : undefined,
    tls: linkTls(params, serverHostname(parsed.url)),
  });
}

function anyTlsToOutbound(parsed: ParsedAnyTlsLink, tag: string): Outbound {
  const params = parsed.url.searchParams;
  return dropUndefined({
    type: 'anytls',
    tag,
    server: serverHostname(parsed.url),
    server_port: Number(parsed.url.port),
    password: parsed.password,
    idle_session_check_interval: firstParam(
      params,
      'idle_session_check_interval',
    ),
    idle_session_timeout: firstParam(params, 'idle_session_timeout'),
    min_idle_session: optionalNonNegativeInteger(params, 'min_idle_session'),
    tls: linkTls(params, serverHostname(parsed.url)),
  });
}

function linkTls(
  params: URLSearchParams,
  server: string,
): Record<string, unknown> {
  const alpn = firstParam(params, 'alpn')
    ?.split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return dropUndefined({
    enabled: true,
    server_name:
      firstParam(params, 'sni', 'peer', 'serverName', 'server_name') ?? server,
    insecure: parseBooleanParam(
      firstParam(
        params,
        'insecure',
        'allowInsecure',
        'allow_insecure',
        'skip-cert-verify',
      ) ?? null,
    ),
    alpn: alpn?.length ? alpn : undefined,
  });
}

function firstParam(
  params: URLSearchParams,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = params.get(key);
    if (value) return value;
  }
  return undefined;
}

function optionalBooleanParam(
  params: URLSearchParams,
  ...keys: string[]
): boolean | undefined {
  const value = firstParam(params, ...keys);
  return value === undefined ? undefined : parseBooleanParam(value);
}

function optionalPositiveNumber(
  params: URLSearchParams,
  ...keys: string[]
): number | undefined {
  const value = firstParam(params, ...keys);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid numeric parameter: ${keys[0]}`);
  }
  return parsed;
}

function optionalNonNegativeInteger(
  params: URLSearchParams,
  ...keys: string[]
): number | undefined {
  const value = firstParam(params, ...keys);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid numeric parameter: ${keys[0]}`);
  }
  return parsed;
}

function ensureUniqueTag(tag: string, usage: Map<string, number>): string {
  const normalized = tag.trim() || 'node';
  const current = usage.get(normalized) ?? 0;
  usage.set(normalized, current + 1);
  if (current === 0) return normalized;
  return `${normalized} (${current})`;
}

function parseBooleanParam(
  value: string | null,
  defaultValue = false,
): boolean {
  if (value == null) return defaultValue;
  const normalized = value.toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

function dropUndefined<T extends Record<string, unknown>>(input: T): T {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined && value !== null) {
      result[key] = value;
    }
  }
  return result as T;
}

function normalizeSpiderX(value: string | null): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed === '/') return undefined;
  return trimmed;
}

function decodeBase64String(data: string): string {
  const sanitized = data.replace(/-/g, '+').replace(/_/g, '/');
  const padding = sanitized.length % 4;
  const padded =
    padding === 0 ? sanitized : sanitized + '='.repeat((4 - padding) % 4);
  try {
    return atob(padded);
  } catch (error) {
    throw new Error(
      `Failed to decode base64 payload: ${(error as Error).message}`,
    );
  }
}
