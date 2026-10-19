// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { useDemoHousehold } from '@/features/house-scanner/hooks/use-demo-household';
import {
  DEMO_OTHER_USER_ID,
  DEMO_USER_ID,
} from '@/features/house-scanner/mock/synthetic-household';
import { NoteConflictError } from '@/features/house-scanner/types/notes';

afterEach(cleanup);

const BALCONY = '00000000-0000-4000-8000-000000000010';
const TERRACE = '00000000-0000-4000-8000-000000000011';

describe('demo hidden homes', () => {
  it('hides and unhides in memory, and leaves the field out when none are hidden', async () => {
    const { result } = renderHook(useDemoHousehold);
    expect(result.current.snapshot.hiddenListingIds).toBeUndefined();
    await act(() => result.current.setHidden([BALCONY, TERRACE], true));
    expect(result.current.snapshot.hiddenListingIds).toEqual([
      BALCONY,
      TERRACE,
    ]);
    await act(() => result.current.setHidden([BALCONY], false));
    expect(result.current.snapshot.hiddenListingIds).toEqual([TERRACE]);
    await act(() => result.current.setHidden([TERRACE], false));
    expect(result.current.snapshot.hiddenListingIds).toBeUndefined();
  });
});

describe('demo household notes', () => {
  it('seeds fictional notes from both members', async () => {
    const { result } = renderHook(useDemoHousehold);
    const balcony = await result.current.loadNotes(BALCONY);
    expect(balcony.map((note) => note.userId)).toEqual([DEMO_OTHER_USER_ID]);
    const terrace = await result.current.loadNotes(TERRACE);
    expect(terrace.map((note) => note.userId)).toEqual([
      DEMO_USER_ID,
      DEMO_OTHER_USER_ID,
    ]);
    await expect(result.current.loadNotes('missing')).resolves.toEqual([]);
  });

  it('creates the own note at revision 0 and bumps the revision on each edit', async () => {
    const { result } = renderHook(useDemoHousehold);
    await expect(result.current.saveNote(BALCONY, 'First', 0)).resolves.toBe(1);
    await expect(result.current.saveNote(BALCONY, 'Second', 1)).resolves.toBe(
      2,
    );
    const notes = await result.current.loadNotes(BALCONY);
    const own = notes.find((note) => note.userId === DEMO_USER_ID);
    expect(own).toMatchObject({ body: 'Second', revision: 2 });
    expect(
      notes.find((note) => note.userId === DEMO_OTHER_USER_ID),
    ).toMatchObject({ revision: 1 });
  });

  it('never writes the other member note', async () => {
    const { result } = renderHook(useDemoHousehold);
    await result.current.saveNote(TERRACE, 'Mine only', 1);
    const notes = await result.current.loadNotes(TERRACE);
    expect(
      notes.find((note) => note.userId === DEMO_OTHER_USER_ID)?.body,
    ).not.toBe('Mine only');
  });

  it.each([
    ['a revision from the future', TERRACE, 9],
    ['revision 0 over an existing note', TERRACE, 0],
    ['a revision for a note that does not exist', BALCONY, 3],
  ])('rejects %s like the server', async (_label, listingId, revision) => {
    const { result } = renderHook(useDemoHousehold);
    await expect(
      result.current.saveNote(listingId, 'draft', revision),
    ).rejects.toBeInstanceOf(NoteConflictError);
  });

  it('rejects a second save made at an already used revision', async () => {
    const { result } = renderHook(useDemoHousehold);
    await result.current.saveNote(TERRACE, 'Edited', 1);
    await expect(
      result.current.saveNote(TERRACE, 'Edited again', 1),
    ).rejects.toBeInstanceOf(NoteConflictError);
  });

  it('allows clearing a note by saving an empty string', async () => {
    const { result } = renderHook(useDemoHousehold);
    await result.current.saveNote(TERRACE, '', 1);
    const notes = await result.current.loadNotes(TERRACE);
    expect(notes.find((note) => note.userId === DEMO_USER_ID)).toMatchObject({
      body: '',
      revision: 2,
    });
  });

  it('starts from the seeded notes after the demo is left and reopened', async () => {
    const first = renderHook(useDemoHousehold);
    await first.result.current.saveNote(TERRACE, 'Changed', 1);
    first.unmount();
    const second = renderHook(useDemoHousehold);
    const notes = await second.result.current.loadNotes(TERRACE);
    expect(notes.find((note) => note.userId === DEMO_USER_ID)).toMatchObject({
      revision: 1,
    });
    expect(JSON.stringify(notes)).not.toContain('Changed');
  });

  it('stores the initial note of a manual link as a shared note, not as evidence', async () => {
    const { result } = renderHook(useDemoHousehold);
    await act(() =>
      result.current.addManual({
        url: 'https://example.invalid/new-home',
        title: 'New fictional home',
        note: '  Initial thought  ',
        tags: [],
      }),
    );
    const added = result.current.snapshot.listings.find(
      (listing) => listing.title === 'New fictional home',
    );
    if (!added) throw new Error('The manual listing was not added.');
    expect(added.evidence).toEqual([]);
    const notes = await result.current.loadNotes(added.id);
    expect(notes).toMatchObject([
      { userId: DEMO_USER_ID, body: 'Initial thought', revision: 1 },
    ]);
  });

  it('adds no note for a blank initial note', async () => {
    const { result } = renderHook(useDemoHousehold);
    await act(() =>
      result.current.addManual({
        url: 'https://example.invalid/quiet-home',
        title: 'Quiet fictional home',
        note: '   ',
        tags: [],
      }),
    );
    const added = result.current.snapshot.listings.find(
      (listing) => listing.title === 'Quiet fictional home',
    );
    if (!added) throw new Error('The manual listing was not added.');
    await expect(result.current.loadNotes(added.id)).resolves.toEqual([]);
  });
});
