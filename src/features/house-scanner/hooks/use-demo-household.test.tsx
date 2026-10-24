// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';

import { useDemoHousehold } from '@/features/house-scanner/hooks/use-demo-household';
import {
  DEMO_OTHER_USER_ID,
  DEMO_USER_ID,
} from '@/features/house-scanner/mock/synthetic-household';
import { NO_MANUAL_FACTS } from '@/features/house-scanner/types/contracts';
import { NoteConflictError } from '@/features/house-scanner/types/notes';

afterEach(cleanup);

const BALCONY = '00000000-0000-4000-8000-000000000010';
const TERRACE = '00000000-0000-4000-8000-000000000011';

it('starts onboarding with an empty household and saves the accepted identity in memory', async () => {
  const { result } = renderHook(() => useDemoHousehold(true));
  expect(result.current.snapshot.members).toHaveLength(1);
  expect(result.current.snapshot.favorites).toEqual([]);
  expect(await result.current.loadNotes(TERRACE)).toEqual([]);
  await act(() =>
    result.current.acceptInvitation('New demo home', 'New member'),
  );
  expect(result.current.snapshot.members[0]).toMatchObject({
    displayName: 'New member',
    role: 'owner',
  });
  expect(await result.current.access.load()).toMatchObject({
    name: 'New demo home',
    members: [{ displayName: 'New member', role: 'owner' }],
  });
  await act(() =>
    result.current.saveProfile(result.current.snapshot.profiles[0]),
  );
  expect(result.current.snapshot.profiles[0].revision).toBe(2);
});

it('joins as a member and makes demo invitations reopen the simulated flow', async () => {
  const { result } = renderHook(() => useDemoHousehold());
  await act(() => result.current.acceptInvitation(null, 'Joined member'));
  expect(
    result.current.snapshot.members.find(
      ({ userId }) => userId === DEMO_USER_ID,
    ),
  ).toMatchObject({ displayName: 'Joined member', role: 'member' });
  expect(
    result.current.snapshot.members.some(({ role }) => role === 'owner'),
  ).toBe(true);
  expect(await result.current.access.createLink('join')).toBe(
    `${window.location.origin}/shellter?demo=join`,
  );
});

it('hides and unhides in memory, and leaves the field out when none are hidden', async () => {
  const { result } = renderHook(useDemoHousehold);
  const hidden = () =>
    result.current.snapshot.hides?.map(({ listingId, userId }) => ({
      listingId,
      userId,
    }));
  expect(hidden()).toBeUndefined();
  await act(() => result.current.setHidden([BALCONY, TERRACE], true));
  expect(hidden()).toEqual([
    { listingId: BALCONY, userId: DEMO_USER_ID },
    { listingId: TERRACE, userId: DEMO_USER_ID },
  ]);
  await act(() => result.current.setHidden([BALCONY, TERRACE], false));
  expect(hidden()).toBeUndefined();
});

it('follows the server note rules: own note only, revisions in order, stale saves refused', async () => {
  const { result } = renderHook(useDemoHousehold);
  await expect(result.current.saveNote(BALCONY, 'First', 0)).resolves.toBe(1);
  await expect(result.current.saveNote(BALCONY, '', 1)).resolves.toBe(2);
  for (const [listingId, revision] of [
    [BALCONY, 1],
    [BALCONY, 9],
    [TERRACE, 0],
  ] as const)
    await expect(
      result.current.saveNote(listingId, 'stale', revision),
    ).rejects.toBeInstanceOf(NoteConflictError);
  const notes = await result.current.loadNotes(BALCONY);
  expect(notes.find((note) => note.userId === DEMO_USER_ID)).toMatchObject({
    body: '',
    revision: 2,
  });
  expect(
    notes.find((note) => note.userId === DEMO_OTHER_USER_ID),
  ).toMatchObject({ revision: 1 });
});

it('starts from the seeded notes after the demo is left and reopened', async () => {
  const first = renderHook(useDemoHousehold);
  await first.result.current.saveNote(TERRACE, 'Changed', 1);
  first.unmount();
  const second = renderHook(useDemoHousehold);
  const notes = await second.result.current.loadNotes(TERRACE);
  expect(JSON.stringify(notes)).not.toContain('Changed');
});

it('stores a manual link note as a shared note, not as evidence, and none for a blank note', async () => {
  const { result } = renderHook(useDemoHousehold);
  const add = (title: string, note: string) =>
    act(() =>
      result.current.addManual({
        url: `https://example.invalid/${title.length}`,
        title,
        note,
        imageUrls: [],
        facts: NO_MANUAL_FACTS,
      }),
    );
  const find = (title: string) => {
    const found = result.current.snapshot.listings.find(
      (listing) => listing.title === title,
    );
    if (!found) throw new Error(`${title} was not added.`);
    return found;
  };
  await add('New fictional home', '  Initial thought  ');
  await add('Quiet home', '   ');
  expect(find('New fictional home').evidence).toEqual([]);
  expect(
    await result.current.loadNotes(find('New fictional home').id),
  ).toMatchObject([
    { userId: DEMO_USER_ID, body: 'Initial thought', revision: 1 },
  ]);
  expect(await result.current.loadNotes(find('Quiet home').id)).toEqual([]);
});

it('edits a manual listing and deletes it with its favorites, never a catalog one', async () => {
  const { result } = renderHook(useDemoHousehold);
  await act(() =>
    result.current.addManual({
      url: 'https://example.invalid/edit-me',
      title: 'Before',
      note: '',
      imageUrls: [],
      facts: NO_MANUAL_FACTS,
    }),
  );
  const find = () =>
    result.current.snapshot.listings.find((l) => l.origin === 'manual');
  const id = find()?.id ?? '';
  await act(() =>
    result.current.updateManual(id, {
      title: 'After',
      imageUrls: ['https://example.invalid/p.jpg'],
      facts: { ...NO_MANUAL_FACTS, rooms: 4 },
    }),
  );
  expect(find()).toMatchObject({
    title: 'After',
    photo: { url: 'https://example.invalid/p.jpg' },
    facts: { rooms: 4 },
  });
  await act(() => result.current.saveFavorite(id));
  const catalog = result.current.snapshot.listings.find(
    (l) => l.origin !== 'manual',
  );
  await act(() => result.current.deleteManual(catalog?.id ?? ''));
  expect(result.current.snapshot.listings).toContainEqual(catalog);
  await act(() => result.current.deleteManual(id));
  expect(find()).toBeUndefined();
  expect(
    result.current.snapshot.favorites.some((f) => f.listingId === id),
  ).toBe(false);
});
