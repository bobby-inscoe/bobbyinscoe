// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { deferred } from '@/features/house-scanner/api/session-test-helpers';
import {
  type LoadNotes,
  type SaveNote,
  useListingNotes,
} from '@/features/house-scanner/hooks/use-listing-notes';
import {
  type ListingNote,
  NoteConflictError,
} from '@/features/house-scanner/types/notes';

afterEach(cleanup);

const USER = '00000000-0000-4000-8000-000000000002';
const OTHER = '00000000-0000-4000-8000-000000000003';
const note = (userId: string, body: string, revision = 1): ListingNote => ({
  userId,
  body,
  revision,
  editedAt: '2026-10-12T11:00:00Z',
});

function mount(options: {
  listingId: string | null;
  onLoad: LoadNotes;
  onSave?: SaveNote;
}) {
  return renderHook(
    (props: { listingId: string | null }) =>
      useListingNotes({
        listingId: props.listingId,
        userId: USER,
        onLoad: options.onLoad,
        onSave: options.onSave ?? vi.fn<SaveNote>(),
      }),
    { initialProps: { listingId: options.listingId } },
  );
}

describe('useListingNotes', () => {
  it('reports notes as unavailable without callbacks', () => {
    const { result } = renderHook(() =>
      useListingNotes({ listingId: 'a', userId: USER }),
    );
    expect(result.current.status).toBe('unavailable');
  });

  it('ignores a late response for a listing that is no longer open', async () => {
    const late = deferred<ListingNote[] | null>();
    const onLoad = vi.fn<LoadNotes>(async (id) =>
      id === 'a' ? late.promise : [note(OTHER, 'Note for b')],
    );
    const { result, rerender } = mount({ listingId: 'a', onLoad });
    expect(result.current.status).toBe('loading');
    rerender({ listingId: 'b' });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => {
      late.resolve([note(OTHER, 'Note for a')]);
    });
    expect(result.current.notes.map((entry) => entry.body)).toEqual([
      'Note for b',
    ]);
  });

  it('shows a load error and loads again on retry', async () => {
    const onLoad = vi
      .fn<LoadNotes>()
      .mockRejectedValueOnce(new Error('synthetic'))
      .mockResolvedValue([note(OTHER, 'Loaded')]);
    const { result } = mount({ listingId: 'a', onLoad });
    await waitFor(() => expect(result.current.status).toBe('error'));
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.notes).toHaveLength(1);
  });

  it('uses the own note as the draft baseline and saves with its revision', async () => {
    const onLoad = vi
      .fn<LoadNotes>()
      .mockResolvedValueOnce([note(USER, 'Mine', 3)])
      .mockResolvedValue([note(USER, 'Mine, edited', 4)]);
    const onSave = vi.fn<SaveNote>().mockResolvedValue(4);
    const { result } = mount({ listingId: 'a', onLoad, onSave });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.draft).toBe('Mine');
    expect(result.current.dirty).toBe(false);
    act(() => result.current.setDraft('Mine, edited'));
    expect(result.current.dirty).toBe(true);
    await act(async () => result.current.save());
    await waitFor(() => expect(result.current.result).toBe('Note saved.'));
    expect(onSave).toHaveBeenCalledWith('a', 'Mine, edited', 3);
    expect(result.current.dirty).toBe(false);
    expect(result.current.ownNote?.revision).toBe(4);
  });

  it('keeps the draft through a conflict and a failed reload', async () => {
    const onLoad = vi
      .fn<LoadNotes>()
      .mockResolvedValueOnce([note(USER, 'Mine', 1)])
      .mockResolvedValueOnce([note(USER, 'Changed elsewhere', 2)])
      .mockRejectedValueOnce(new Error('synthetic'))
      .mockResolvedValue([note(USER, 'Changed elsewhere', 2)]);
    const onSave = vi
      .fn<SaveNote>()
      .mockRejectedValueOnce(new NoteConflictError());
    const { result } = mount({ listingId: 'a', onLoad, onSave });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    act(() => result.current.setDraft('My draft'));
    await act(async () => result.current.save());
    await waitFor(() => expect(result.current.conflict).toBe(true));
    expect(result.current.draft).toBe('My draft');
    expect(result.current.ownNote?.body).toBe('Changed elsewhere');
    expect(result.current.result).toBe('');

    act(() => result.current.retry());
    await waitFor(() => expect(result.current.status).toBe('error'));
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.draft).toBe('My draft');
    expect(result.current.conflict).toBe(true);
  });

  it('saves over the latest revision only when asked, and can discard the draft', async () => {
    const onLoad = vi
      .fn<LoadNotes>()
      .mockResolvedValueOnce([note(USER, 'Mine', 1)])
      .mockResolvedValueOnce([note(USER, 'Changed elsewhere', 2)])
      .mockResolvedValue([note(USER, 'My draft', 3)]);
    const onSave = vi
      .fn<SaveNote>()
      .mockRejectedValueOnce(new NoteConflictError())
      .mockResolvedValue(3);
    const { result } = mount({ listingId: 'a', onLoad, onSave });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    act(() => result.current.setDraft('My draft'));
    await act(async () => result.current.save());
    await waitFor(() => expect(result.current.conflict).toBe(true));
    expect(onSave).toHaveBeenCalledTimes(1);

    await act(async () => result.current.keepDraftAndSave());
    await waitFor(() => expect(result.current.conflict).toBe(false));
    expect(onSave).toHaveBeenLastCalledWith('a', 'My draft', 2);
    expect(result.current.ownNote?.body).toBe('My draft');
  });

  it('discards the draft and clears the conflict on request', async () => {
    const onLoad = vi
      .fn<LoadNotes>()
      .mockResolvedValueOnce([note(USER, 'Mine', 1)])
      .mockResolvedValue([note(USER, 'Changed elsewhere', 2)]);
    const onSave = vi.fn<SaveNote>().mockRejectedValue(new NoteConflictError());
    const { result } = mount({ listingId: 'a', onLoad, onSave });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    act(() => result.current.setDraft('My draft'));
    await act(async () => result.current.save());
    await waitFor(() => expect(result.current.conflict).toBe(true));
    act(() => result.current.discardDraft());
    expect(result.current.conflict).toBe(false);
    expect(result.current.draft).toBe('Changed elsewhere');
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('keeps an unsaved draft per listing while the workspace stays open', async () => {
    const onLoad = vi.fn<LoadNotes>(async () => []);
    const { result, rerender } = mount({ listingId: 'a', onLoad });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    act(() => result.current.setDraft('Draft for a'));
    rerender({ listingId: 'b' });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.draft).toBe('');
    rerender({ listingId: 'a' });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.draft).toBe('Draft for a');
  });

  it('reports a failed save without losing the draft', async () => {
    const onLoad = vi.fn<LoadNotes>(async () => []);
    const onSave = vi.fn<SaveNote>().mockRejectedValue(new Error('synthetic'));
    const { result } = mount({ listingId: 'a', onLoad, onSave });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    act(() => result.current.setDraft('Keep me'));
    await act(async () => result.current.save());
    await waitFor(() =>
      expect(result.current.result).toContain('Could not save'),
    );
    expect(result.current.draft).toBe('Keep me');
    expect(result.current.conflict).toBe(false);
    expect(result.current.saving).toBe(false);
  });

  it('ignores a save result that arrives after the listing changed', async () => {
    const pending = deferred<number | null>();
    const onLoad = vi.fn<LoadNotes>(async () => []);
    const onSave = vi.fn<SaveNote>(() => pending.promise);
    const { result, rerender } = mount({ listingId: 'a', onLoad, onSave });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    act(() => result.current.setDraft('Draft'));
    act(() => result.current.save());
    rerender({ listingId: 'b' });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => {
      pending.resolve(1);
    });
    expect(result.current.result).toBe('');
    expect(result.current.saving).toBe(false);
    expect(onLoad).toHaveBeenCalledTimes(2);
  });
});
