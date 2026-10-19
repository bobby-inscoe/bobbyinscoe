export function formatPrice(value: number | null) {
  return value === null
    ? 'Price unknown'
    : `${new Intl.NumberFormat('sv-SE').format(value)} SEK`;
}

/** A monthly amount such as the fee: 4 250 SEK/month. */
export function formatFee(value: number) {
  return `${new Intl.NumberFormat('sv-SE').format(value)} SEK/month`;
}

/** Short price for a map pin: 850k, 2,8M, 3M. */
export function compactPrice(sek: number) {
  if (sek < 1_000_000) return `${Math.round(sek / 1000)}k`;
  return `${(sek / 1_000_000).toFixed(1).replace('.', ',').replace(',0', '')}M`;
}

export function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeZone: 'Europe/Stockholm',
    timeStyle: 'short',
  }).format(new Date(value));
}
