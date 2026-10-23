export function applyAppMetadata(pathname: string) {
  const shellter =
    pathname === '/shellter' || pathname.startsWith('/shellter/');
  const links = {
    manifest: shellter ? '/shellter/manifest.webmanifest' : '/manifest.json',
    icon: '/favicon.ico',
    'apple-touch-icon': '/apple-touch-icon.png',
  };
  for (const [rel, href] of Object.entries(links)) {
    document
      .querySelector<HTMLLinkElement>(`link[rel="${rel}"]`)
      ?.setAttribute('href', href);
  }
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', shellter ? '#0f6e6a' : '#e9e4d8');
  document.title = shellter ? 'Shellter' : 'Bobby Inscoe | Projects';
}
