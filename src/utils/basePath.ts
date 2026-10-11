const DEPLOYMENT_ASSET_DIRECTORIES = new Set(['assets', 'static', 'icons', 'images']);

const PROXY_PATH_PREFIXES = ['/api', '/ws', '/shell', '/plugin-ws'];

export function detectRouterBasename(): string {
  const explicitBasename = typeof window !== 'undefined' ? window.__ROUTER_BASENAME__ || '' : '';
  if (explicitBasename) {
    return explicitBasename.replace(/\/+$/, '');
  }

  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return '';
  }

  const candidatePaths = [
    { kind: 'manifest' as const, value: document.querySelector('link[rel="manifest"]')?.getAttribute('href') },
    { kind: 'script' as const, value: document.querySelector('script[type="module"][src]')?.getAttribute('src') },
    ...Array.from(
      document.querySelectorAll(
        'link[rel~="icon"][href], link[rel="apple-touch-icon"][href], link[rel="apple-touch-icon-precomposed"][href], link[rel="mask-icon"][href]'
      )
    ).map((node) => ({
      kind: 'icon' as const,
      value: node.getAttribute('href'),
    })),
  ].filter((candidate): candidate is { kind: 'manifest' | 'script' | 'icon'; value: string } => Boolean(candidate.value));

  let detectedBasename = '';
  for (const candidate of candidatePaths) {
    try {
      const candidateUrl = new URL(candidate.value, document.baseURI || window.location.href);
      if (candidateUrl.origin !== window.location.origin) {
        continue;
      }

      const pathname = candidateUrl.pathname;
      const normalizedPathname = pathname.replace(/\/+$/, '');

      let normalized = '';
      if (candidate.kind === 'script') {
        const match = normalizedPathname.match(/^(.*)\/assets\//);
        normalized = match?.[1] ? match[1].replace(/\/+$/, '') : '';
      } else {
        const manifestMatch = normalizedPathname.match(/^(.*)\/(?:manifest\.json|site\.webmanifest)$/);
        const iconMatch = normalizedPathname.match(
          /^(.*)\/(?:favicon(?:\.[^/]+)?|apple-touch-icon(?:-[^/]+)?(?:\.[^/]+)?|mask-icon(?:\.[^/]+)?|[^/]*icon[^/]*)$/
        );
        const match = candidate.kind === 'manifest' ? manifestMatch : iconMatch;
        if (match?.[1]) {
          const segments = match[1].split('/').filter(Boolean);
          while (segments.length > 0 && DEPLOYMENT_ASSET_DIRECTORIES.has(segments[segments.length - 1])) {
            segments.pop();
          }
          normalized = segments.length > 0 ? `/${segments.join('/')}` : '';
        }
      }

      if (normalized.length > detectedBasename.length) {
        detectedBasename = normalized;
      }
    } catch {
      // Ignore invalid candidate URLs and continue checking other hints.
    }
  }

  return detectedBasename;
}

let cachedBasePath: string | null = null;

export function getBasePath(): string {
  if (cachedBasePath === null) {
    cachedBasePath = detectRouterBasename();
  }
  return cachedBasePath;
}

export function withBasePath(url: string): string {
  if (!url || typeof url !== 'string' || url.charAt(0) !== '/') {
    return url;
  }
  for (const prefix of PROXY_PATH_PREFIXES) {
    if (url === prefix) {
      return getBasePath() + url;
    }
    if (url.startsWith(prefix)) {
      const next = url.charAt(prefix.length);
      if (next === '/' || next === '?') {
        return getBasePath() + url;
      }
    }
  }
  return url;
}

export function resetBasePathCache(): void {
  cachedBasePath = null;
}
