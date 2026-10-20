export function getLinkProtocolLabel(rawLink: string): string {
  const scheme = rawLink.trim().match(/^([a-z0-9+.-]+):\/\//)?.[1];

  switch (scheme) {
    case 'vless':
      return 'VLESS';
    case 'vmess':
      return 'VMess';
    case 'trojan':
      return 'Trojan';
    case 'ss':
      return 'Shadowsocks';
    case 'tuic':
      return 'TUIC';
    case 'hysteria2':
    case 'hy2':
      return 'Hysteria2';
    case 'anytls':
      return 'AnyTLS';
    default:
      return 'Unsupported';
  }
}
