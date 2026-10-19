export function normalizeManualUrl(value: string) {
  const url = new URL(value);
  for (const key of [...url.searchParams.keys()]) {
    if (
      key.toLowerCase().startsWith('utm_') ||
      ['fbclid', 'gclid', 'msclkid'].includes(key.toLowerCase())
    )
      url.searchParams.delete(key);
  }
  return url.href;
}
