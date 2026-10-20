import assert from 'node:assert/strict';
import test from 'node:test';

import { convertLinksToOutbounds } from '../src/converter.ts';
import { deriveNameFromLink } from '../src/lib/utils.ts';

function link(rawLink, name = 'node') {
  return {
    id: 'test-link',
    name,
    raw_link: rawLink,
    created_at: 0,
    updated_at: 0,
  };
}

test('converts TUIC credentials and transport options', async () => {
  const [outbound] = await convertLinksToOutbounds([
    link(
      'tuic://uuid:secret@example.com:443?congestion_control=bbr&udp_relay_mode=native&zero_rtt_handshake=true&sni=cdn.example.com&alpn=h3,h2&insecure=1',
      'TUIC',
    ),
  ]);

  assert.deepEqual(outbound, {
    type: 'tuic',
    tag: 'TUIC',
    server: 'example.com',
    server_port: 443,
    uuid: 'uuid',
    password: 'secret',
    congestion_control: 'bbr',
    udp_relay_mode: 'native',
    zero_rtt_handshake: true,
    tls: { enabled: true, server_name: 'cdn.example.com', insecure: true, alpn: ['h3', 'h2'] },
  });
});

test('converts both Hysteria2 URI schemes with obfuscation and bandwidth', async () => {
  for (const scheme of ['hysteria2', 'hy2']) {
    const [outbound] = await convertLinksToOutbounds([
      link(
        `${scheme}://pass%3Aword@example.com:443?upmbps=30&downmbps=100&obfs=salamander&obfs-password=obfs-secret&peer=cdn.example.com`,
      ),
    ]);

    assert.deepEqual(outbound, {
      type: 'hysteria2',
      tag: 'node',
      server: 'example.com',
      server_port: 443,
      password: 'pass:word',
      up_mbps: 30,
      down_mbps: 100,
      obfs: { type: 'salamander', password: 'obfs-secret' },
      tls: { enabled: true, server_name: 'cdn.example.com', insecure: false },
    });
  }
});

test('converts AnyTLS session options and TLS settings', async () => {
  const [outbound] = await convertLinksToOutbounds([
    link(
      'anytls://p%40ss@example.com:8443?sni=cdn.example.com&idle_session_check_interval=30s&idle_session_timeout=1m&min_idle_session=0&skip-cert-verify=true',
    ),
  ]);

  assert.deepEqual(outbound, {
    type: 'anytls',
    tag: 'node',
    server: 'example.com',
    server_port: 8443,
    password: 'p@ss',
    idle_session_check_interval: '30s',
    idle_session_timeout: '1m',
    min_idle_session: 0,
    tls: { enabled: true, server_name: 'cdn.example.com', insecure: true },
  });
});

test('keeps IPv6 server addresses without URL brackets', async () => {
  const [outbound] = await convertLinksToOutbounds([link('hy2://secret@[2001:db8::1]:443')]);

  assert.equal(outbound.server, '2001:db8::1');
  assert.equal(outbound.tls.server_name, '2001:db8::1');
});

test('uses the stored node name for VMess outbound tags', async () => {
  const raw = `vmess://${Buffer.from(
    JSON.stringify({
      v: '2',
      ps: 'Name from link',
      tag: 'Tag from link',
      add: 'example.com',
      port: '443',
      id: '12345678-1234-1234-1234-123456789abc',
      aid: '0',
      net: 'tcp',
      tls: 'tls',
      scy: 'auto',
    }),
  ).toString('base64')}`;
  const [outbound] = await convertLinksToOutbounds([
    {
      ...link(raw, 'Stored node name'),
      tag: 'Node category',
    },
  ]);

  assert.equal(outbound.tag, 'Stored node name');
  assert.equal(outbound.type, 'vmess');
  assert.equal(deriveNameFromLink(raw), 'Name from link');
});

test('uses the stored node name for Shadowsocks outbound tags', async () => {
  const [outbound] = await convertLinksToOutbounds([
    link('ss://aes-128-gcm:password@example.com:8388#Name%20from%20link', 'Stored node name'),
  ]);
  assert.equal(outbound.tag, 'Stored node name');
});
