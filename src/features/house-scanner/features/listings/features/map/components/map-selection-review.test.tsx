// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { IntlProvider } from 'react-intl';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MapSelectionReview } from '@/features/house-scanner/features/listings/features/map/components/map-selection-review';
import { catalogs } from '@/features/house-scanner/i18n/catalogs';
import { SYNTHETIC_SNAPSHOT } from '@/features/house-scanner/mock/synthetic-household';

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    'matchMedia',
    (media: string): MediaQueryList => ({
      media,
      matches: false,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent: () => true,
    }),
  );
});
afterEach(cleanup);

const listings = SYNTHETIC_SNAPSHOT.listings.slice(0, 2);
function props() {
  return {
    listings,
    savedIds: new Set([listings[0].id]),
    busy: false,
    error: '',
    onClose: vi.fn(),
    onHide: vi.fn(),
  };
}

it('starts with saved homes unchecked and submits only the reviewed IDs', () => {
  const input = props();
  render(
    <MantineProvider>
      <IntlProvider
        locale="en-GB"
        defaultLocale="en-GB"
        timeZone="Europe/Stockholm"
        messages={catalogs.en}
      >
        <MapSelectionReview {...input} />
      </IntlProvider>
    </MantineProvider>,
  );
  const saved = screen.getByRole('checkbox', {
    name: `Select ${listings[0].title}`,
  });
  expect((saved as HTMLInputElement).checked).toBe(false);
  expect(
    (
      screen.getByRole('checkbox', {
        name: `Select ${listings[1].title}`,
      }) as HTMLInputElement
    ).checked,
  ).toBe(true);
  fireEvent.click(saved);
  expect(screen.getByRole('status').textContent).toContain(
    'Includes 1 saved home',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Hide 2' }));
  expect(input.onHide).toHaveBeenCalledWith([listings[1].id, listings[0].id]);
});

it('cancel does not submit and a failed hide keeps the reviewed set', () => {
  const input = props();
  const { rerender } = render(
    <MantineProvider>
      <IntlProvider
        locale="en-GB"
        defaultLocale="en-GB"
        timeZone="Europe/Stockholm"
        messages={catalogs.en}
      >
        <MapSelectionReview {...input} />
      </IntlProvider>
    </MantineProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(input.onClose).toHaveBeenCalledOnce();
  expect(input.onHide).not.toHaveBeenCalled();
  rerender(
    <MantineProvider>
      <IntlProvider
        locale="en-GB"
        defaultLocale="en-GB"
        timeZone="Europe/Stockholm"
        messages={catalogs.en}
      >
        <MapSelectionReview {...input} busy />
      </IntlProvider>
    </MantineProvider>,
  );
  expect(
    screen.getByRole('button', { name: 'Hide 1' }).hasAttribute('disabled'),
  ).toBe(true);
  rerender(
    <MantineProvider>
      <IntlProvider
        locale="en-GB"
        defaultLocale="en-GB"
        timeZone="Europe/Stockholm"
        messages={catalogs.en}
      >
        <MapSelectionReview {...input} error="Try again" />
      </IntlProvider>
    </MantineProvider>,
  );
  expect(screen.getByRole('alert').textContent).toContain('Try again');
  expect(
    (
      screen.getByRole('checkbox', {
        name: `Select ${listings[1].title}`,
      }) as HTMLInputElement
    ).checked,
  ).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Hide 1' }));
  expect(input.onHide).toHaveBeenCalledWith([listings[1].id]);
});

it('does not add new results or submit homes removed while review is open', () => {
  const input = props();
  const { rerender } = render(
    <MantineProvider>
      <IntlProvider
        locale="en-GB"
        defaultLocale="en-GB"
        timeZone="Europe/Stockholm"
        messages={catalogs.en}
      >
        <MapSelectionReview {...input} />
      </IntlProvider>
    </MantineProvider>,
  );
  rerender(
    <MantineProvider>
      <IntlProvider
        locale="en-GB"
        defaultLocale="en-GB"
        timeZone="Europe/Stockholm"
        messages={catalogs.en}
      >
        <MapSelectionReview
          {...input}
          listings={[listings[0], SYNTHETIC_SNAPSHOT.listings[2]]}
        />
      </IntlProvider>
    </MantineProvider>,
  );
  expect(
    screen.getByRole('button', { name: 'Hide 0' }).hasAttribute('disabled'),
  ).toBe(true);
  expect(
    screen
      .getAllByRole('checkbox')
      .every((checkbox) => !(checkbox as HTMLInputElement).checked),
  ).toBe(true);
});

it('caps a 501-home capture at 500 and lets users exchange a selected home', () => {
  const input = props();
  const many = Array.from({ length: 501 }, (_, index) => ({
    ...listings[1],
    id: `home-${index}`,
    title: `Home ${index}`,
  }));
  render(
    <MantineProvider>
      <IntlProvider
        locale="en-GB"
        defaultLocale="en-GB"
        timeZone="Europe/Stockholm"
        messages={catalogs.en}
      >
        <MapSelectionReview {...input} listings={many} savedIds={new Set()} />
      </IntlProvider>
    </MantineProvider>,
  );
  const last = screen.getByRole('checkbox', { name: 'Select Home 500' });
  expect((last as HTMLInputElement).checked).toBe(false);
  expect(last.hasAttribute('disabled')).toBe(true);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select Home 0' }));
  expect(last.hasAttribute('disabled')).toBe(false);
  fireEvent.click(last);
  fireEvent.click(screen.getByRole('button', { name: 'Hide 500' }));
  const ids = input.onHide.mock.calls[0][0];
  expect(ids).toHaveLength(500);
  expect(ids).not.toContain('home-0');
  expect(ids).toContain('home-500');
});
