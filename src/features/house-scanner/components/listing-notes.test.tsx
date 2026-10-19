// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ListingNotes } from '@/features/house-scanner/components/listing-notes';
import type { ListingNotesController } from '@/features/house-scanner/hooks/use-listing-notes';
import {
  DEMO_OTHER_USER_ID,
  DEMO_USER_ID,
  SYNTHETIC_SNAPSHOT,
} from '@/features/house-scanner/mock/synthetic-household';

beforeEach(() => {
  vi.stubGlobal(
    'matchMedia',
    (media: string): MediaQueryList => ({
      media,
      matches: false,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => true,
    }),
  );
});
afterEach(cleanup);

const mine = {
  userId: DEMO_USER_ID,
  body: 'My fictional note',
  revision: 2,
  editedAt: '2026-10-12T11:00:00Z',
};
const theirs = {
  userId: DEMO_OTHER_USER_ID,
  body: 'Morgan fictional note',
  revision: 1,
  editedAt: '2026-10-12T12:00:00Z',
};

function controller(
  overrides: Partial<ListingNotesController> = {},
): ListingNotesController {
  return {
    status: 'ready',
    notes: [],
    ownNote: null,
    draft: '',
    dirty: false,
    saving: false,
    conflict: false,
    result: '',
    setDraft: vi.fn(),
    retry: vi.fn(),
    save: vi.fn(),
    keepDraftAndSave: vi.fn(),
    discardDraft: vi.fn(),
    ...overrides,
  };
}

function view(value?: ListingNotesController) {
  return (
    <MantineProvider>
      <ListingNotes
        controller={value}
        members={SYNTHETIC_SNAPSHOT.members}
        userId={DEMO_USER_ID}
      />
    </MantineProvider>
  );
}

describe('ListingNotes', () => {
  it('says notes are unavailable without a controller', () => {
    render(view(undefined));
    expect(
      screen.getByText('Shared notes are unavailable in this view.'),
    ).toBeTruthy();
  });

  it('shows a loading status and no editor while loading', () => {
    render(view(controller({ status: 'loading' })));
    expect(
      screen.getAllByRole('status').map((region) => region.textContent),
    ).toContain('Loading notes…');
    expect(screen.queryByLabelText('Your shared note')).toBeNull();
  });

  it('shows an empty state with the editor', () => {
    render(view(controller()));
    expect(screen.getByText('No notes yet.')).toBeTruthy();
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.getByLabelText('Your shared note')).toBeTruthy();
  });

  it('offers retry on a load error', () => {
    const value = controller({ status: 'error' });
    render(view(value));
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Notes could not be loaded.');
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(value.retry).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText('Your shared note')).toBeNull();
  });

  it('lists every note with its author and edit date, and labels the own note', () => {
    render(
      view(
        controller({
          notes: [
            theirs,
            mine,
            { ...theirs, userId: 'unknown-member', body: 'Left the household' },
          ],
          ownNote: mine,
          draft: mine.body,
        }),
      ),
    );
    const list = screen.getByRole('list', { name: 'Household notes' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0].textContent).toContain('Demo Morgan · edited');
    expect(items[0].textContent).toContain('Morgan fictional note');
    expect(items[1].textContent).toContain('You (Demo Alex) · edited');
    expect(items[1].textContent).toMatch(/edited .*2026/);
    expect(items[2].textContent).toContain('Household member · edited');
  });

  it('describes the editor with its character count and caps the length', () => {
    render(view(controller({ draft: 'Hello' })));
    const field = screen.getByLabelText('Your shared note');
    expect(field.getAttribute('maxlength')).toBe('2000');
    const description = field.getAttribute('aria-describedby');
    expect(description).toBeTruthy();
    expect(document.getElementById(description ?? '')?.textContent).toBe(
      '5 of 2000 characters',
    );
  });

  it('sends typed text to the controller', () => {
    const value = controller();
    render(view(value));
    fireEvent.change(screen.getByLabelText('Your shared note'), {
      target: { value: 'Typed' },
    });
    expect(value.setDraft).toHaveBeenCalledWith('Typed');
  });

  it('disables save while the draft is unchanged and saves when changed', () => {
    const { rerender } = render(view(controller()));
    const button = () => screen.getByRole('button', { name: 'Save note' });
    expect((button() as HTMLButtonElement).disabled).toBe(true);
    const value = controller({ dirty: true, draft: 'New' });
    rerender(view(value));
    expect((button() as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(button());
    expect(value.save).toHaveBeenCalledTimes(1);
  });

  it('announces the save result in a status region', () => {
    render(view(controller({ result: 'Note saved.' })));
    expect(
      screen
        .getAllByRole('status')
        .some((region) => region.textContent === 'Note saved.'),
    ).toBe(true);
  });

  it('moves focus to the conflict alert and offers both choices', () => {
    const { rerender } = render(
      view(controller({ dirty: true, draft: 'Draft', ownNote: mine })),
    );
    expect(screen.queryByRole('alert')).toBeNull();
    const value = controller({
      conflict: true,
      dirty: true,
      draft: 'Draft',
      notes: [{ ...mine, body: 'Latest from another tab', revision: 3 }],
      ownNote: { ...mine, body: 'Latest from another tab', revision: 3 },
    });
    rerender(view(value));
    const alert = screen.getByRole('alert');
    expect(document.activeElement).toBe(alert);
    expect(alert.textContent).toContain('Latest from another tab');
    fireEvent.click(
      within(alert).getByRole('button', {
        name: 'Keep my draft and save over latest',
      }),
    );
    expect(value.keepDraftAndSave).toHaveBeenCalledTimes(1);
    fireEvent.click(
      within(alert).getByRole('button', {
        name: 'Use latest and discard my draft',
      }),
    );
    expect(value.discardDraft).toHaveBeenCalledTimes(1);
    expect(value.save).not.toHaveBeenCalled();
    expect(
      (screen.getByRole('button', { name: 'Save note' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});
