import { useState } from 'react';

import {
  createDemoNoteStore,
  DEMO_USER_ID,
  SYNTHETIC_SNAPSHOT,
} from '@/features/house-scanner/mock/synthetic-household';
import type {
  ManualSubmission,
  SearchProfile,
  Snapshot,
} from '@/features/house-scanner/types/contracts';
import { normalizeManualUrl } from '@/features/house-scanner/utils/manual-url';

const HOUR = 3_600_000;
// Demo viewings are made relative to now, since a fixed date would be over the day after it was written.
const BALCONY_HOME = '00000000-0000-4000-8000-000000000010';
const TERRACE_HOME = '00000000-0000-4000-8000-000000000011';
function demoViewings(snapshot: Snapshot): Snapshot {
  const inDays = (days: number) =>
    new Date(Math.ceil((Date.now() + days * 24 * HOUR) / HOUR) * HOUR);
  const slot = (days: number, hours = 1) => ({
    startsAt: inDays(days).toISOString(),
    endsAt: new Date(inDays(days).getTime() + hours * HOUR).toISOString(),
  });
  return {
    ...snapshot,
    listings: snapshot.listings.map((listing) =>
      listing.id === BALCONY_HOME
        ? { ...listing, viewings: [slot(1), slot(8)] }
        : listing.id === TERRACE_HOME
          ? { ...listing, viewings: [slot(3)] }
          : listing,
    ),
  };
}

export function useDemoHousehold() {
  const [snapshot, setSnapshot] = useState<Snapshot>(() =>
    demoViewings(structuredClone(SYNTHETIC_SNAPSHOT)),
  );
  const [notes] = useState(createDemoNoteStore);
  async function saveFavorite(listingId: string) {
    setSnapshot((current) =>
      current.favorites.some(
        (favorite) =>
          favorite.listingId === listingId && favorite.userId === DEMO_USER_ID,
      )
        ? current
        : {
            ...current,
            favorites: [
              ...current.favorites,
              {
                householdId: current.householdId,
                listingId,
                userId: DEMO_USER_ID,
                savedAt: new Date().toISOString(),
              },
            ],
          },
    );
  }
  async function saveFavorites(listingIds: string[]) {
    const ids = [...new Set(listingIds)];
    const available = new Set(snapshot.listings.map((listing) => listing.id));
    if (ids.length > 500 || ids.some((id) => !available.has(id)))
      throw new Error('Select up to 500 homes that are still available.');
    const savedAt = new Date().toISOString();
    setSnapshot((current) => {
      const saved = new Set(
        current.favorites
          .filter((favorite) => favorite.userId === DEMO_USER_ID)
          .map((favorite) => favorite.listingId),
      );
      const pending = ids.filter((id) => !saved.has(id));
      return pending.length
        ? {
            ...current,
            favorites: [
              ...current.favorites,
              ...pending.map((listingId) => ({
                householdId: current.householdId,
                listingId,
                userId: DEMO_USER_ID,
                savedAt,
              })),
            ],
          }
        : current;
    });
  }
  async function removeFavorite(listingId: string) {
    setSnapshot((current) => ({
      ...current,
      favorites: current.favorites.filter(
        (favorite) =>
          favorite.listingId !== listingId || favorite.userId !== DEMO_USER_ID,
      ),
    }));
  }
  async function setHidden(listingIds: string[], hidden: boolean) {
    const hiddenAt = new Date().toISOString();
    setSnapshot((current) => {
      const ids = new Set(listingIds);
      const hides = [
        ...(current.hides ?? []).filter((hide) => !ids.has(hide.listingId)),
        ...(hidden
          ? [...ids].map((listingId) => ({
              listingId,
              userId: DEMO_USER_ID,
              hiddenAt,
            }))
          : []),
      ];
      return { ...current, hides: hides.length ? hides : undefined };
    });
  }
  async function addManual(submission: ManualSubmission) {
    const url = normalizeManualUrl(submission.url);
    const now = new Date().toISOString();
    if (
      snapshot.listings.some((listing) =>
        listing.sourceUrls.some(
          (sourceUrl) => normalizeManualUrl(sourceUrl) === url,
        ),
      )
    )
      return;
    const listingId = crypto.randomUUID();
    // Like hs_add_manual, a non-blank initial note becomes the adder's shared note.
    const note = submission.note.trim();
    if (note) notes.save(DEMO_USER_ID, listingId, note, 0);
    setSnapshot((current) => {
      return {
        ...current,
        listings: [
          ...current.listings,
          {
            id: listingId,
            householdId: current.householdId,
            origin: 'manual',
            title: submission.title || new URL(url).hostname,
            sourceUrls: [url],
            facts: {
              propertyType: null,
              tenure: 'unknown',
              purchase: null,
              livingAreaM2: null,
              secondaryAreaM2: null,
              rooms: null,
              askingPriceSek: null,
              groundFloor: null,
              lift: null,
              liftServesHome: null,
              stepFree: null,
              outdoor: null,
              glazed: null,
              largePrivateTerrace: null,
              municipality: null,
              baseFeeSek: null,
              mandatoryMonthlySek: null,
              status: 'unknown',
            },
            conflicts: [],
            coordinates: null,
            photo: null,
            previousAskingPriceSek: null,
            observedAt: now,
            addedBy: DEMO_USER_ID,
            userTags: submission.tags,
            evidence: [],
          },
        ],
      };
    });
  }
  async function saveProfile(profile: SearchProfile) {
    setSnapshot((current) => ({
      ...current,
      profiles: current.profiles.map((existing) =>
        existing.id === profile.id && existing.revision === profile.revision
          ? {
              ...profile,
              revision: existing.revision + 1,
              editedBy: DEMO_USER_ID,
              editedAt: new Date().toISOString(),
            }
          : existing,
      ),
    }));
  }
  async function loadNotes(listingId: string) {
    return notes.list(listingId);
  }
  async function saveNote(listingId: string, body: string, revision: number) {
    return notes.save(DEMO_USER_ID, listingId, body, revision);
  }
  return {
    snapshot,
    saveFavorite,
    saveFavorites,
    removeFavorite,
    setHidden,
    addManual,
    saveProfile,
    loadNotes,
    saveNote,
  };
}
