import {
  type MessageFormatElement,
  parse,
} from '@formatjs/icu-messageformat-parser';
import { createIntl, createIntlCache } from 'react-intl';
import { describe, expect, it } from 'vitest';
import {
  catalogs,
  englishIntl,
  flattenMessages,
  formatFeedback,
  isMessageId,
  MessageError,
} from '@/features/house-scanner/i18n/catalogs';
import { en } from '@/features/house-scanner/i18n/en';
import { sv } from '@/features/house-scanner/i18n/sv';
import { SYNTHETIC_SNAPSHOT } from '@/features/house-scanner/mock/synthetic-household';
import { formatRooms } from '@/features/house-scanner/utils/criteria-options';
import {
  compactPrice,
  formatPrice,
} from '@/features/house-scanner/utils/format';
import { viewingCalendar } from '@/features/house-scanner/utils/viewings';

const swedishIntl = createIntl(
  {
    locale: 'sv-SE',
    defaultLocale: 'en-GB',
    messages: catalogs.sv,
    timeZone: 'Europe/Stockholm',
    onError: (error) => {
      throw error;
    },
  },
  createIntlCache(),
);
function argumentsIn(message: string) {
  const names = new Set<string>();
  function visit(elements: MessageFormatElement[]) {
    for (const element of elements) {
      if (
        element.type === 1 ||
        element.type === 2 ||
        element.type === 3 ||
        element.type === 4
      )
        names.add(element.value);
      if (element.type === 5 || element.type === 6) {
        names.add(element.value);
        for (const option of Object.values(element.options))
          visit(option.value);
      }
      if (element.type === 8) visit(element.children);
    }
  }
  visit(parse(message));
  return [...names].sort();
}

describe('Shellter translation catalogs', () => {
  it('has the same leaf paths and ICU arguments in English and Swedish and formats every message', () => {
    const english = flattenMessages(en);
    const swedish = flattenMessages(sv);
    expect(Object.keys(swedish).sort()).toEqual(Object.keys(english).sort());
    for (const [id, text] of Object.entries(english)) {
      expect(argumentsIn(swedish[id]), id).toEqual(argumentsIn(text));
      expect(isMessageId(id)).toBe(true);
      if (!isMessageId(id)) throw new Error(id);
      const values = Object.fromEntries(
        argumentsIn(text).map((name) => [
          name,
          name === 'count' || name === 'saved' ? 2 : 'example',
        ]),
      );
      expect(swedishIntl.formatMessage({ id }, values), id).not.toBe(id);
      const intl = createIntl(
        {
          locale: 'en-GB',
          messages: catalogs.en,
          onError: (error) => {
            throw error;
          },
        },
        createIntlCache(),
      );
      expect(intl.formatMessage({ id }, values), id).not.toBe(id);
    }
  });

  it('uses the selected locale for room plurals, decimals and prices', () => {
    expect(formatRooms(1, englishIntl)).toBe('1 room');
    expect(formatRooms(2.5, englishIntl)).toBe('2.5 rooms');
    expect(formatRooms(2.5, swedishIntl)).toBe('2,5 rum');
    expect(compactPrice(2_800_000, englishIntl)).toBe('2.8M');
    expect(compactPrice(2_800_000, swedishIntl)).toBe('2,8M');
    expect(formatPrice(null, swedishIntl)).toBe('Okänt pris');
    for (const count of [0, 1, 2]) {
      expect(
        swedishIntl.formatMessage(
          { id: 'listings.list.hiddenCount' },
          { count },
        ),
      ).toContain(count === 1 ? 'bostad dold' : 'bostäder dolda');
    }
  });

  it('can reformat retained count-aware failures without repeating their operation', () => {
    const error = new MessageError('errors.favoritesReloadFailed', {
      count: 2,
    });
    expect(formatFeedback(englishIntl, error.feedback)).toContain(
      'Saved 2 new favorites',
    );
    expect(formatFeedback(swedishIntl, error.feedback)).toContain(
      'Sparade 2 nya favoriter',
    );
  });

  it('localizes calendar text while preserving event identity and UTC times', () => {
    const listing = SYNTHETIC_SNAPSHOT.listings[0];
    const viewing = {
      startsAt: '2026-10-24T13:00:00Z',
      endsAt: '2026-10-24T14:00:00Z',
    };
    const now = Date.parse('2026-10-22T12:00:00Z');
    const english = viewingCalendar(listing, viewing, now, englishIntl);
    const swedish = viewingCalendar(listing, viewing, now, swedishIntl);
    for (const prefix of ['UID:', 'DTSTART:', 'DTEND:']) {
      expect(
        swedish.split('\r\n').find((line) => line.startsWith(prefix)),
      ).toBe(english.split('\r\n').find((line) => line.startsWith(prefix)));
    }
    expect(swedish).toContain('SUMMARY:Visning:');
    expect(swedish).toContain('DESCRIPTION:Annons:');
    expect(swedish).toContain('om en vecka');
    expect(swedish).toContain('i morgon');
  });
});
