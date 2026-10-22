// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  addManual,
  clearOwnedSessionStorage,
  createHouseholdClient,
  deleteManual,
  householdSnapshot,
  householdStart,
  privateBackendSettings,
  saveNote,
  saveProfile,
  setFavorite,
  setFavorites,
  setHidden,
  setRememberDevice,
  updateManual,
} from '@/features/house-scanner/api/household-client';
import {
  AUTH_KEY,
  fixtureSnapshot,
  HOUSEHOLD_ID,
  missing,
  OTHER_HOUSEHOLD_ID,
  OTHER_USER_ID,
  reply,
  resetSdk,
  sdk,
  sdkStorage,
  sdkStorageKey,
  toV2,
  USER_ID,
  v2Snapshot,
} from '@/features/house-scanner/api/session-test-helpers';
import {
  NO_MANUAL_FACTS,
  type Snapshot,
} from '@/features/house-scanner/types/contracts';
import { NoteConflictError } from '@/features/house-scanner/types/notes';

vi.mock('@supabase/supabase-js', async () => {
  const fake = await import(
    '@/features/house-scanner/api/session-test-helpers'
  );
  return { createClient: fake.createClient };
});
beforeEach(resetSdk);
function client() {
  const active = createHouseholdClient();
  if (!active) throw new Error('Synthetic backend should be configured.');
  return active;
}

describe('House Scanner storage boundaries', () => {
  it.each([
    ['VITE_HOUSE_SCANNER_ENABLED', 'false'],
    [
      'VITE_HOUSE_SCANNER_SUPABASE_URL',
      'https://user:password@example.invalid',
    ],
    ['VITE_HOUSE_SCANNER_SUPABASE_URL', 'http://example.invalid'],
    [
      'VITE_HOUSE_SCANNER_SUPABASE_URL',
      'https://example.invalid/?private=value',
    ],
    [
      'VITE_HOUSE_SCANNER_SUPABASE_PUBLISHABLE_KEY',
      'service_role_synthetic_invalid',
    ],
  ])('rejects unsafe configuration %s = %s', (name, value) => {
    vi.stubEnv(name, value);
    expect(privateBackendSettings()).toBeNull();
  });
  it('uses a namespaced SDK storage key', () => {
    client();
    expect(sdkStorageKey).toBe(AUTH_KEY);
  });
  it.each([false, true])(
    'keeps SDK tokens in the chosen store when remember is %s',
    (remember) => {
      client();
      setRememberDevice(remember);
      sdkStorage.setItem(sdkStorageKey, 'synthetic token only');
      const selected = remember ? window.localStorage : window.sessionStorage;
      const other = remember ? window.sessionStorage : window.localStorage;
      expect(selected.getItem(AUTH_KEY)).toBe('synthetic token only');
      expect(other.getItem(AUTH_KEY)).toBeNull();
      expect(sdkStorage.getItem(AUTH_KEY)).toBe('synthetic token only');
      sdkStorage.removeItem(AUTH_KEY);
      expect(selected.getItem(AUTH_KEY)).toBeNull();
      expect(other.getItem(AUTH_KEY)).toBeNull();
    },
  );
  it('session preference overrides a remembered local preference', () => {
    client();
    window.localStorage.setItem('house-scanner.remember', 'true');
    window.sessionStorage.setItem('house-scanner.remember', 'false');
    sdkStorage.setItem(AUTH_KEY, 'synthetic session only');
    expect(window.sessionStorage.getItem(AUTH_KEY)).toBe(
      'synthetic session only',
    );
    expect(window.localStorage.getItem(AUTH_KEY)).toBeNull();
  });
  it('clears only owned keys in both stores and removes the old remember choice', () => {
    for (const store of [window.localStorage, window.sessionStorage]) {
      store.setItem('duck-feed:high-scores', '[123]');
      store.setItem('portfolio.preference', 'green');
      store.setItem(AUTH_KEY, 'synthetic token');
      store.setItem(`${AUTH_KEY}-code-verifier`, 'synthetic verifier');
      store.setItem('house-scanner.remember', 'true');
    }
    clearOwnedSessionStorage();
    for (const store of [window.localStorage, window.sessionStorage]) {
      expect(Object.keys(store).sort()).toEqual([
        'duck-feed:high-scores',
        'portfolio.preference',
      ]);
    }
  });
  it('switching remember off removes persisted tokens before the next login', () => {
    client();
    setRememberDevice(true);
    sdkStorage.setItem(AUTH_KEY, 'synthetic old token');
    setRememberDevice(false);
    expect(window.localStorage.getItem(AUTH_KEY)).toBeNull();
    expect(window.localStorage.getItem('house-scanner.remember')).toBeNull();
    expect(window.sessionStorage.getItem('house-scanner.remember')).toBe(
      'false',
    );
  });
  it('reports cleanup failure but still clears the other storage area', () => {
    window.sessionStorage.setItem(AUTH_KEY, 'synthetic token');
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('Denied', 'SecurityError');
    });
    expect(clearOwnedSessionStorage).toThrow(
      'Browser storage could not be cleared',
    );
    expect(window.sessionStorage.getItem(AUTH_KEY)).toBeNull();
  });
});

describe('House Scanner RPC boundaries', () => {
  const own = () => [fixtureSnapshot().members[0]];
  it('accepts a valid private response', async () => {
    await expect(
      householdSnapshot(client(), HOUSEHOLD_ID, USER_ID, own()),
    ).resolves.toEqual(fixtureSnapshot());
    expect(sdk.rpc.mock.calls).toEqual([
      ['hs_household_snapshot', { p_household_id: HOUSEHOLD_ID }],
    ]);
  });
  it('reads a source home from the read model', async () => {
    sdk.rpc.mockResolvedValueOnce(reply(v2Snapshot()));
    const snapshot = await householdSnapshot(
      client(),
      HOUSEHOLD_ID,
      USER_ID,
      own(),
    );
    expect(snapshot.listings).toEqual([
      expect.objectContaining({
        householdId: HOUSEHOLD_ID,
        origin: 'source',
        title: 'Read model home',
        sourceUrls: ['https://example.invalid/home'],
      }),
    ]);
  });
  it.each([
    ['a newer contract', { ...v2Snapshot(), contractVersion: 3 }],
    [
      'an invalid value',
      {
        ...v2Snapshot(),
        listings: [
          { ...v2Snapshot().listings[0], facts: { tenure: 'leasehold' } },
        ],
      },
    ],
    [
      'a home in an area the reply lacks',
      {
        ...v2Snapshot(),
        listings: [
          { ...v2Snapshot().listings[0], neighborhoodId: 'goteborg-101' },
        ],
      },
    ],
  ])(
    'refuses a read model reply with %s and reads nothing else',
    async (_label, data) => {
      sdk.rpc.mockResolvedValueOnce(reply(data));
      await expect(
        householdSnapshot(client(), HOUSEHOLD_ID, USER_ID, own()),
      ).rejects.toThrow(
        'The server returned an unsupported household response.',
      );
      expect(sdk.rpc).toHaveBeenCalledTimes(1);
    },
  );
  it('asks for the memberships and the snapshot in one request', async () => {
    sdk.rpc.mockResolvedValueOnce(
      reply({ memberships: own(), snapshot: v2Snapshot() }),
    );
    await expect(householdStart(client(), null)).resolves.toEqual({
      memberships: own(),
      snapshot: v2Snapshot(),
    });
    expect(sdk.rpc).toHaveBeenLastCalledWith('hs_household_start', {});
    sdk.rpc.mockResolvedValueOnce(
      reply({ memberships: own(), snapshot: null }),
    );
    await householdStart(client(), HOUSEHOLD_ID);
    expect(sdk.rpc).toHaveBeenLastCalledWith('hs_household_start', {
      p_household_id: HOUSEHOLD_ID,
    });
  });
  it.each([
    ['missing', missing(), 'household request failed'],
    ['unreadable', reply(own()), 'unsupported household response'],
    [
      'oversized',
      reply({
        memberships: Array.from({ length: 11 }, () => own()[0]),
        snapshot: null,
      }),
      'unsupported household response',
    ],
  ])('reports a start request that is %s', async (_label, answer, message) => {
    sdk.rpc.mockResolvedValueOnce(answer);
    await expect(householdStart(client(), null)).rejects.toThrow(message);
    expect(sdk.rpc).toHaveBeenCalledTimes(1);
  });
  it('reports a failed start request without database details', async () => {
    sdk.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'synthetic confidential database detail' },
    });
    await expect(householdStart(client(), null)).rejects.toThrow(
      'The household request failed. Reload and try again.',
    );
  });
  it('reads no snapshot when the start request already sent it', async () => {
    const snapshot = await householdSnapshot(
      client(),
      HOUSEHOLD_ID,
      USER_ID,
      own(),
      v2Snapshot(),
    );
    expect(snapshot.listings).toEqual([
      expect.objectContaining({ title: 'Read model home' }),
    ]);
    expect(sdk.rpc).not.toHaveBeenCalled();
  });
  it('saves favorites in one request of at most 500 listings', async () => {
    const [first, second] = fixtureSnapshot().listings;
    await setFavorites(client(), HOUSEHOLD_ID, [first.id, second.id], true);
    expect(sdk.rpc).toHaveBeenLastCalledWith('hs_set_favorites', {
      p_household_id: HOUSEHOLD_ID,
      p_listing_ids: [first.id, second.id],
      p_saved: true,
    });
    expect(() =>
      setFavorites(client(), HOUSEHOLD_ID, Array(501).fill(first.id), true),
    ).toThrow();
    expect(() => setFavorites(client(), HOUSEHOLD_ID, [], true)).toThrow();
  });
  it('reports an authorization failure without another request', async () => {
    sdk.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: '42501', message: 'Access denied' },
    });
    await expect(
      householdSnapshot(client(), HOUSEHOLD_ID, USER_ID, own()),
    ).rejects.toThrow('household request failed');
    expect(sdk.rpc).toHaveBeenCalledTimes(1);
  });
  it('does not request a snapshot without current matching membership', async () => {
    await expect(
      householdSnapshot(client(), HOUSEHOLD_ID, USER_ID, [
        { ...fixtureSnapshot().members[0], userId: OTHER_USER_ID },
      ]),
    ).rejects.toThrow('no longer active');
    expect(sdk.rpc).not.toHaveBeenCalled();
  });
  const noteRow = (listingId: string, userId: string) => ({
    listingId,
    userId,
    body: 'sample',
    revision: 1,
    editedAt: '2026-10-17T10:00:00.000Z',
  });
  // What a server bug could send in v2. The household of each row is the reply's own, so only the reply's can differ.
  const invalidSnapshots: [string, (snapshot: Snapshot) => void][] = [
    [
      'snapshot household',
      (s) => {
        s.householdId = OTHER_HOUSEHOLD_ID;
      },
    ],
    [
      'missing viewer',
      (s) => {
        s.members = s.members.filter((m) => m.userId !== USER_ID);
      },
    ],
    [
      'unknown favorite listing',
      (s) => {
        s.favorites[0].listingId = OTHER_HOUSEHOLD_ID;
      },
    ],
    [
      'unknown favorite actor',
      (s) => {
        s.favorites[0].userId = OTHER_HOUSEHOLD_ID;
      },
    ],
    [
      'duplicate listing',
      (s) => {
        s.listings.push(s.listings[0]);
      },
    ],
    [
      'duplicate member',
      (s) => {
        s.members.push(s.members[0]);
      },
    ],
    [
      'note on a listing that is not in the snapshot',
      (s) => {
        s.notes = [noteRow('00000000-0000-4000-8000-0000000000ff', USER_ID)];
      },
    ],
    [
      'note by someone who is not a member',
      (s) => {
        s.notes = [noteRow(s.listings[0].id, OTHER_HOUSEHOLD_ID)];
      },
    ],
    [
      'household hide of a listing that is not in the snapshot',
      (s) => {
        s.hides = [
          {
            listingId: '00000000-0000-4000-8000-0000000000ff',
            userId: USER_ID,
            hiddenAt: '2026-10-20T12:00:00Z',
          },
        ];
      },
    ],
    [
      'household hide by someone who is not a member',
      (s) => {
        s.hides = [
          {
            listingId: s.listings[0].id,
            userId: OTHER_HOUSEHOLD_ID,
            hiddenAt: '2026-10-20T12:00:00Z',
          },
        ];
      },
    ],
  ];
  it.each(invalidSnapshots)(
    'rejects inconsistent %s data',
    async (_label, change) => {
      const snapshot = fixtureSnapshot();
      change(snapshot);
      sdk.rpc.mockResolvedValueOnce(reply(toV2(snapshot)));
      await expect(
        householdSnapshot(client(), HOUSEHOLD_ID, USER_ID, own()),
      ).rejects.toThrow('inconsistent household data');
    },
  );
  it.each([null, {}, { contractVersion: 2 }, fixtureSnapshot()])(
    'rejects unsupported snapshot responses %#',
    async (data) => {
      sdk.rpc.mockResolvedValueOnce(reply(data));
      await expect(
        householdSnapshot(client(), HOUSEHOLD_ID, USER_ID, own()),
      ).rejects.toThrow('unsupported household response');
    },
  );
  it('does not reveal database details in RPC errors', async () => {
    sdk.rpc.mockResolvedValue({
      data: null,
      error: { message: 'synthetic confidential database detail' },
    });
    await expect(
      householdSnapshot(client(), HOUSEHOLD_ID, USER_ID, own()),
    ).rejects.toThrow('The household request failed. Reload and try again.');
  });
  it('reports a note revision conflict as a typed error', async () => {
    sdk.rpc.mockResolvedValue({
      data: null,
      error: { message: 'Note changed; reload before saving', code: '40001' },
    });
    await expect(
      saveNote(
        client(),
        HOUSEHOLD_ID,
        fixtureSnapshot().listings[0].id,
        'draft',
        1,
      ),
    ).rejects.toBeInstanceOf(NoteConflictError);
  });
  it.each([
    ['another SQLSTATE on a note save', 'hs_save_note', '42501'],
    ['no SQLSTATE on a note save', 'hs_save_note', undefined],
    ['a conflict code on a profile save', 'hs_save_profile', '40001'],
  ])('keeps the generic message for %s', async (_label, name, code) => {
    sdk.rpc.mockResolvedValue({
      data: null,
      error: { message: 'synthetic confidential database detail', code },
    });
    const listingId = fixtureSnapshot().listings[0].id;
    const call =
      name === 'hs_save_note'
        ? saveNote(client(), HOUSEHOLD_ID, listingId, 'draft', 1)
        : saveProfile(client(), HOUSEHOLD_ID, fixtureSnapshot().profiles[0]);
    await expect(call).rejects.toThrow(
      'The household request failed. Reload and try again.',
    );
    await expect(call).rejects.not.toBeInstanceOf(NoteConflictError);
  });
  it('leaves favorite actor identity to the server', async () => {
    await setFavorite(
      client(),
      HOUSEHOLD_ID,
      fixtureSnapshot().listings[0].id,
      false,
    );
    expect(sdk.rpc).toHaveBeenCalledWith('hs_set_favorite', {
      p_household_id: HOUSEHOLD_ID,
      p_listing_id: fixtureSnapshot().listings[0].id,
      p_saved: false,
    });
  });
  it('keeps a snapshot whose notes belong to its listings and members', async () => {
    const snapshot = fixtureSnapshot();
    snapshot.notes = [
      noteRow(snapshot.listings[0].id, snapshot.members[0].userId),
    ];
    sdk.rpc.mockResolvedValueOnce(reply(toV2(snapshot)));
    await expect(
      householdSnapshot(client(), HOUSEHOLD_ID, USER_ID, own()),
    ).resolves.toMatchObject({ notes: [{ body: 'sample' }] });
  });
  it('sends hides as a list and leaves the member to the server', async () => {
    const ids = fixtureSnapshot().listings.map((listing) => listing.id);
    await setHidden(client(), HOUSEHOLD_ID, ids, true);
    expect(sdk.rpc).toHaveBeenCalledWith('hs_set_hidden', {
      p_household_id: HOUSEHOLD_ID,
      p_listing_ids: ids,
      p_hidden: true,
    });
  });
  it('refuses an empty, oversized or malformed id list before calling the server', () => {
    expect(() => setHidden(client(), HOUSEHOLD_ID, [], true)).toThrow();
    expect(() => setHidden(client(), HOUSEHOLD_ID, ['nope'], true)).toThrow();
    expect(() =>
      setHidden(
        client(),
        HOUSEHOLD_ID,
        Array.from(
          { length: 501 },
          (_, index) =>
            `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
        ),
        true,
      ),
    ).toThrow();
    expect(sdk.rpc).not.toHaveBeenCalled();
  });
  it('removes tracking query parameters from manual links without fetching them', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    sdk.rpc.mockResolvedValue(
      reply({ listingId: fixtureSnapshot().listings[0].id, existing: false }),
    );
    await addManual(client(), HOUSEHOLD_ID, {
      url: 'https://example.invalid/home?utm_source=test&keep=yes&fbclid=tracking#photos',
      title: ' Fictional home ',
      note: ' Note ',
      imageUrls: [],
      facts: NO_MANUAL_FACTS,
    });
    expect(sdk.rpc).toHaveBeenCalledWith('hs_add_manual', {
      p_household_id: HOUSEHOLD_ID,
      p_url: 'https://example.invalid/home?keep=yes#photos',
      p_title: 'Fictional home',
      p_note: 'Note',
      p_tags: [],
      p_image_urls: [],
      p_facts: {},
    });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('sends photo links and the facts the member filled in, and refuses a plain http photo', async () => {
    sdk.rpc.mockResolvedValue(
      reply({ listingId: fixtureSnapshot().listings[0].id, existing: false }),
    );
    const submission = {
      url: 'https://example.invalid/home',
      title: '',
      note: '',
      imageUrls: ['https://example.invalid/a.jpg'],
      facts: { ...NO_MANUAL_FACTS, rooms: 3, outdoor: 'balcony' as const },
    };
    await addManual(client(), HOUSEHOLD_ID, submission);
    expect(sdk.rpc).toHaveBeenCalledWith(
      'hs_add_manual',
      expect.objectContaining({
        p_image_urls: ['https://example.invalid/a.jpg'],
        p_facts: { rooms: 3, outdoor: 'balcony' },
      }),
    );
    expect(() =>
      addManual(client(), HOUSEHOLD_ID, {
        ...submission,
        imageUrls: ['http://example.invalid/a.jpg'],
      }),
    ).toThrow();
  });
  it('sends an edit with only the facts that are set, and a delete by id', async () => {
    sdk.rpc.mockResolvedValue(reply({ ok: true }));
    const listingId = fixtureSnapshot().listings[0].id;
    await updateManual(client(), HOUSEHOLD_ID, listingId, {
      title: ' New ',
      imageUrls: [],
      facts: { ...NO_MANUAL_FACTS, rooms: 2 },
    });
    expect(sdk.rpc).toHaveBeenCalledWith('hs_update_manual', {
      p_household_id: HOUSEHOLD_ID,
      p_listing_id: listingId,
      p_title: 'New',
      p_image_urls: [],
      p_facts: { rooms: 2 },
    });
    await deleteManual(client(), HOUSEHOLD_ID, listingId);
    expect(sdk.rpc).toHaveBeenCalledWith('hs_delete_manual', {
      p_household_id: HOUSEHOLD_ID,
      p_listing_id: listingId,
    });
  });
  it('rejects a profile owned by another household before calling the server', () => {
    const profile = fixtureSnapshot().profiles[0];
    expect(() => saveProfile(client(), OTHER_HOUSEHOLD_ID, profile)).toThrow(
      'another household',
    );
    expect(sdk.rpc).not.toHaveBeenCalled();
  });
  it('sends the expected profile revision without accepting actor input', async () => {
    const profile = fixtureSnapshot().profiles[0];
    sdk.rpc.mockResolvedValue(reply({ revision: 2 }));
    await expect(saveProfile(client(), HOUSEHOLD_ID, profile)).resolves.toEqual(
      { revision: 2 },
    );
    expect(sdk.rpc).toHaveBeenCalledWith('hs_save_profile', {
      p_household_id: HOUSEHOLD_ID,
      p_profile_id: profile.id,
      p_revision: 1,
      p_name: profile.name,
      p_enabled: profile.enabled,
      p_criteria: profile.criteria,
    });
  });
  it('validates note and mutation responses', async () => {
    sdk.rpc.mockResolvedValue(reply({ ok: false }));
    await expect(
      setFavorite(
        client(),
        HOUSEHOLD_ID,
        fixtureSnapshot().listings[0].id,
        true,
      ),
    ).rejects.toThrow('unsupported household response');
    expect(() =>
      saveNote(
        client(),
        HOUSEHOLD_ID,
        fixtureSnapshot().listings[0].id,
        'x'.repeat(2001),
        0,
      ),
    ).toThrow();
  });
});
