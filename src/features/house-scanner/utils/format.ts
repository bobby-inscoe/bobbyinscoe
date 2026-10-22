import type { IntlShape } from 'react-intl';
import { englishIntl } from '@/features/house-scanner/i18n/catalogs';

export function formatPrice(
  value: number | null,
  intl: IntlShape = englishIntl,
) {
  return value === null
    ? intl.formatMessage({ id: 'listings.details.priceUnknown' })
    : `${intl.formatNumber(value)} SEK`;
}
export function formatFee(value: number, intl: IntlShape = englishIntl) {
  return `${intl.formatNumber(value)} ${intl.formatMessage({ id: 'listings.details.monthlyUnit' })}`;
}
export function compactPrice(sek: number, intl: IntlShape = englishIntl) {
  return sek < 1_000_000
    ? `${intl.formatNumber(Math.round(sek / 1000), { useGrouping: false })}k`
    : `${intl.formatNumber(sek / 1_000_000, { maximumFractionDigits: 1, useGrouping: false })}M`;
}
export function formatDate(value: string, intl: IntlShape = englishIntl) {
  return new Intl.DateTimeFormat(intl.locale, {
    dateStyle: 'medium',
    timeZone: 'Europe/Stockholm',
    timeStyle: 'short',
  }).format(new Date(value));
}
