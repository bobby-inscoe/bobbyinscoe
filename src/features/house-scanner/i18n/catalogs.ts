import { createIntl, createIntlCache, type IntlShape } from 'react-intl';

type PrimitiveType = string | number | boolean | Date | null | undefined;

import { en } from '@/features/house-scanner/i18n/en';
import { sv } from '@/features/house-scanner/i18n/sv';
import type { MessageId } from '@/features/house-scanner/i18n/types/translations';

export function flattenMessages(
  tree: object,
  prefix = '',
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(tree)) {
    const id = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') result[id] = value;
    else Object.assign(result, flattenMessages(value, id));
  }
  return result;
}
export const catalogs = {
  en: flattenMessages(en) as Record<MessageId, string>,
  sv: { ...flattenMessages(en), ...flattenMessages(sv) } as Record<
    MessageId,
    string
  >,
};
export const englishIntl = createIntl(
  {
    locale: 'en-GB',
    defaultLocale: 'en-GB',
    timeZone: 'Europe/Stockholm',
    messages: catalogs.en,
  },
  createIntlCache(),
);
export type Feedback =
  | string
  | { id: MessageId; values?: Record<string, PrimitiveType> };
export function isMessageId(value: string): value is MessageId {
  return Object.hasOwn(catalogs.en, value);
}
export function formatFeedback(
  intl: IntlShape,
  feedback: Feedback | null | undefined,
): string {
  if (!feedback) return '';
  if (typeof feedback === 'object')
    return intl.formatMessage(
      feedback,
      feedback.id === 'validation.invalidField'
        ? {
            ...feedback.values,
            field: intl.formatMessage({
              id:
                typeof feedback.values?.field === 'string' &&
                isMessageId(feedback.values.field)
                  ? feedback.values.field
                  : 'validation.field',
            }),
          }
        : feedback.values,
    );
  return isMessageId(feedback)
    ? intl.formatMessage({ id: feedback })
    : feedback;
}
export function errorFeedback(error: unknown): Feedback {
  if (error instanceof MessageError) return error.feedback;
  return error instanceof Error && isMessageId(error.message)
    ? error.message
    : 'errors.theHouseholdRequestFailedReloadAndTryAgain';
}
export function messageValue(value: unknown): string | number {
  return typeof value === 'string' || typeof value === 'number' ? value : '';
}
export function validationFeedback(
  issues: { message: string; path: PropertyKey[] }[],
): Feedback {
  const issue = issues[0];
  if (issue && isMessageId(issue.message)) return issue.message;
  const fields: Record<string, MessageId> = {
    url: 'listings.addLink.listingLink',
    title: 'listings.details.title',
    imageUrls: 'listings.addLink.photoLinkOptional',
    askingPriceSek: 'listings.details.askingPrice',
    livingAreaM2: 'listings.details.livingArea',
    rooms: 'listings.details.rooms',
    minAreaM2: 'settings.criteria.minimumLivingArea',
    maxAreaM2: 'settings.criteria.maximumLivingArea',
    minRooms: 'settings.criteria.minimumRooms',
    preferredPriceSek: 'settings.criteria.preferredBudgetSEK',
    stretchPriceSek: 'settings.criteria.stretchBudgetSEK',
    feeReferenceSek: 'settings.criteria.monthlyFeeReferenceSEKACostFlag',
  };
  const field = issue?.path
    .map(String)
    .reverse()
    .find((part) => fields[part]);
  return {
    id: 'validation.invalidField',
    values: { field: field ? fields[field] : 'validation.field' },
  };
}

export class MessageError extends Error {
  readonly feedback: Exclude<Feedback, string>;
  constructor(id: MessageId, values?: Record<string, PrimitiveType>) {
    super(id);
    this.name = 'MessageError';
    this.feedback = { id, values };
  }
}
