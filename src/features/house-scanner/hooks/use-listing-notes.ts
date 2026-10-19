import { useCallback, useEffect, useRef, useState } from 'react';

import {
  type ListingNote,
  NoteConflictError,
} from '@/features/house-scanner/types/notes';

export type LoadNotes = (listingId: string) => Promise<ListingNote[] | null>;
export type SaveNote = (
  listingId: string,
  body: string,
  revision: number,
) => Promise<number | null>;

type LoadState =
  | { status: 'loading'; listingId: string }
  | { status: 'error'; listingId: string }
  | { status: 'ready'; listingId: string; notes: ListingNote[] };

export interface ListingNotesController {
  status: 'unavailable' | 'loading' | 'error' | 'ready';
  notes: ListingNote[];
  ownNote: ListingNote | null;
  draft: string;
  dirty: boolean;
  saving: boolean;
  conflict: boolean;
  result: string;
  setDraft: (value: string) => void;
  retry: () => void;
  save: () => void;
  keepDraftAndSave: () => void;
  discardDraft: () => void;
}

const SAVE_FAILED = 'Could not save your note. Your draft is kept. Try again.';

interface UseListingNotesOptions {
  listingId: string | null;
  userId: string;
  onLoad?: LoadNotes;
  onSave?: SaveNote;
}

// Owns the notes for the one listing whose details are open. Unsaved drafts are
// kept per listing for the life of the workspace and never leave memory.
export function useListingNotes({
  listingId,
  userId,
  onLoad,
  onSave,
}: UseListingNotesOptions): ListingNotesController {
  const [load, setLoad] = useState<LoadState | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [conflictFor, setConflictFor] = useState<string | null>(null);
  const [resultFor, setResultFor] = useState<{
    listingId: string;
    message: string;
  } | null>(null);
  const [reloads, setReloads] = useState(0);
  // Bumped when the listing changes or the component unmounts, so late
  // responses for a listing nobody is looking at are dropped.
  const token = useRef(0);
  const callbacks = useRef({ onLoad, onSave });
  callbacks.current = { onLoad, onSave };
  const available = Boolean(onLoad && onSave);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reloads is a manual retry trigger
  useEffect(() => {
    if (!listingId || !available) return;
    const mine = token.current;
    const load = callbacks.current.onLoad;
    if (!load) return;
    setLoad({ status: 'loading', listingId });
    load(listingId).then(
      (notes) => {
        if (mine === token.current && notes)
          setLoad({ status: 'ready', listingId, notes });
      },
      () => {
        if (mine === token.current) setLoad({ status: 'error', listingId });
      },
    );
    return () => {
      token.current += 1;
      setSaving(false);
    };
  }, [listingId, available, reloads]);

  const current = load && load.listingId === listingId ? load : null;
  const notes = current?.status === 'ready' ? current.notes : [];
  const ownNote = notes.find((note) => note.userId === userId) ?? null;
  const draft =
    (listingId ? drafts[listingId] : undefined) ?? ownNote?.body ?? '';
  const dirty = draft !== (ownNote?.body ?? '');
  const conflict = conflictFor !== null && conflictFor === listingId;
  const result = resultFor?.listingId === listingId ? resultFor.message : '';

  const write = useCallback(
    async (body: string, revision: number) => {
      const { onLoad: load, onSave: save } = callbacks.current;
      if (!listingId || !load || !save) return;
      const mine = token.current;
      const stale = () => mine !== token.current;
      setSaving(true);
      setResultFor(null);
      try {
        const saved = await save(listingId, body, revision);
        if (saved === null || stale()) return;
        const latest = await load(listingId);
        if (stale()) return;
        if (latest) setLoad({ status: 'ready', listingId, notes: latest });
        setDrafts(({ [listingId]: _saved, ...rest }) => rest);
        setConflictFor(null);
        setResultFor({ listingId, message: 'Note saved.' });
      } catch (error) {
        if (stale()) return;
        if (error instanceof NoteConflictError) {
          try {
            const latest = await load(listingId);
            if (stale()) return;
            if (latest) setLoad({ status: 'ready', listingId, notes: latest });
            setConflictFor(listingId);
          } catch {
            if (!stale()) {
              setLoad({ status: 'error', listingId });
              setResultFor({ listingId, message: SAVE_FAILED });
            }
          }
          return;
        }
        setResultFor({ listingId, message: SAVE_FAILED });
      } finally {
        if (!stale()) setSaving(false);
      }
    },
    [listingId],
  );

  return {
    status: !available ? 'unavailable' : (current?.status ?? 'loading'),
    notes,
    ownNote,
    draft,
    dirty,
    saving,
    conflict,
    result,
    setDraft(value) {
      if (!listingId) return;
      setDrafts((previous) => ({ ...previous, [listingId]: value }));
      setResultFor(null);
    },
    retry() {
      setReloads((count) => count + 1);
    },
    save() {
      if (!dirty || saving || conflict) return;
      void write(draft, ownNote?.revision ?? 0);
    },
    keepDraftAndSave() {
      if (saving) return;
      void write(draft, ownNote?.revision ?? 0);
    },
    discardDraft() {
      if (!listingId) return;
      setDrafts(({ [listingId]: _discarded, ...rest }) => rest);
      setConflictFor(null);
    },
  };
}
