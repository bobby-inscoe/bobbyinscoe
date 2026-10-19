import type { UserLabel } from './config';
import type { ApiResult, Caller, Gateway, SignInResult } from './gateway';

// A small in-memory stand-in for the household API, used only by unit tests.
// It models the contract the checks rely on, plus switches that break it in the
// specific ways the checks exist to catch.

export interface Flaws {
  /** hs_snapshot answers non-members instead of raising. */
  leakSnapshotToOutsiders?: boolean;
  /** Anonymous callers are allowed to run the household functions. */
  anonAllowed?: boolean;
  /** Authenticated callers may run hs_purge_expired. */
  purgeAllowed?: boolean;
  /** The hs schema is reachable through the API. */
  hsSchemaExposed?: boolean;
  /** A stale note save fails with this code instead of 40001. */
  staleCode?: string;
  /** Note saves ignore the revision, so concurrent saves both win. */
  noRevisionCheck?: boolean;
  /** Sign-in is refused for every user. */
  signInFails?: boolean;
  /** A deactivated A2 can still read. */
  a2StillActive?: boolean;
}

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const FAKE_IDS = {
  userA: uuid(1),
  userA2: uuid(2),
  userB: uuid(3),
  householdA: uuid(11),
  householdB: uuid(12),
};
const USER_IDS: Record<UserLabel, string> = {
  A: FAKE_IDS.userA,
  A2: FAKE_IDS.userA2,
  B: FAKE_IDS.userB,
};
const EMPTY_FACTS = {
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
};
const CRITERIA = {
  minAreaM2: 50,
  maxAreaM2: null,
  minRooms: 2,
  preferredPriceSek: 2_000_000,
  stretchPriceSek: 3_000_000,
  propertyTypes: ['apartment'],
  excludeGroundFloor: false,
  requireLift: false,
  requireOutdoor: false,
  preferGlazing: false,
  feeReferenceSek: 4000,
  geography: { municipalities: ['Zq town'], center: [0, 0], radiusKm: 10 },
  nature: { preferImmediateGreenery: false, preferredWalkMinutes: 10 },
  transit: {
    preferredWalkMinutes: 10,
    preferredJourneyMinutes: 30,
    tradeoffJourneyMinutes: 60,
  },
};

interface Listing {
  id: string;
  householdId: string;
  url: string;
  title: string;
}
interface Note {
  householdId: string;
  listingId: string;
  userId: string;
  body: string;
  revision: number;
}

const SERVICE_ONLY = new Set([
  'hs_purge_expired',
  'hs_ingest_credential',
  'hs_consume_nonce',
  'hs_ingest_policies',
  'hs_ingest',
]);

export function createFakeGateway(
  flaws: Flaws = {},
  options: { a2Deactivated?: boolean } = {},
): Gateway & { log: string[] } {
  const members: { householdId: string; userId: string; role: string }[] = [
    { householdId: FAKE_IDS.householdA, userId: FAKE_IDS.userA, role: 'owner' },
    {
      householdId: FAKE_IDS.householdA,
      userId: FAKE_IDS.userA2,
      role: 'member',
    },
    { householdId: FAKE_IDS.householdB, userId: FAKE_IDS.userB, role: 'owner' },
  ];
  const listings: Listing[] = [];
  const favorites: {
    householdId: string;
    listingId: string;
    userId: string;
  }[] = [];
  const notes: Note[] = [];
  const log: string[] = [];
  let counter = 100;

  const denied = (
    status: number,
    code: string,
    message: string,
  ): ApiResult => ({
    status,
    data: null,
    error: { code, message },
  });
  const ok = (data: unknown): ApiResult => ({ status: 200, data, error: null });
  const active = (householdId: string, userId: string | null) =>
    userId !== null &&
    members.some((m) => m.householdId === householdId && m.userId === userId) &&
    !(
      options.a2Deactivated &&
      !flaws.a2StillActive &&
      userId === FAKE_IDS.userA2
    );
  const noAccess = () => denied(403, '42501', 'Household access denied');

  function call(
    userId: string | null,
    name: string,
    args: Record<string, unknown>,
  ): ApiResult {
    log.push(`${userId === null ? 'anon' : 'user'} ${name}`);
    const household = String(args.p_household_id ?? '');
    const listing = String(args.p_listing_id ?? '');
    if (userId === null && !flaws.anonAllowed)
      return denied(401, '42501', `permission denied for function ${name}`);
    if (SERVICE_ONLY.has(name))
      return flaws.purgeAllowed
        ? ok({ dryRun: true })
        : denied(403, '42501', `permission denied for function ${name}`);
    if (name.startsWith('admin_'))
      return denied(404, 'PGRST202', `Could not find the function ${name}`);
    switch (name) {
      case 'hs_memberships':
        return ok(
          members
            .filter((m) => m.userId === userId && active(m.householdId, userId))
            .map((m) => ({
              householdId: m.householdId,
              userId: m.userId,
              displayName: 'FICTIONAL member',
              role: m.role,
            })),
        );
      case 'hs_add_manual': {
        if (!active(household, userId)) return noAccess();
        const url = String(args.p_url);
        const existing = listings.find(
          (l) => l.householdId === household && l.url === url,
        );
        if (existing) return ok({ listingId: existing.id, existing: true });
        counter += 1;
        const created = {
          id: uuid(counter),
          householdId: household,
          url,
          title: String(args.p_title),
        };
        listings.push(created);
        return ok({ listingId: created.id, existing: false });
      }
      case 'hs_snapshot': {
        if (!active(household, userId) && !flaws.leakSnapshotToOutsiders)
          return noAccess();
        const owner =
          members.find((m) => m.householdId === household)?.userId ??
          FAKE_IDS.userA;
        return ok({
          contractVersion: 1,
          householdId: household,
          edition: null,
          members: members
            .filter((m) => m.householdId === household)
            .map((m) => ({
              householdId: m.householdId,
              userId: m.userId,
              displayName: 'FICTIONAL member',
              role: m.role,
            })),
          profiles: [
            {
              id: uuid(900),
              householdId: household,
              revision: 1,
              name: 'FICTIONAL profile',
              enabled: true,
              criteria: CRITERIA,
              editedBy: owner,
              editedAt: '2026-10-13T00:00:00Z',
            },
          ],
          listings: listings
            .filter((l) => l.householdId === household)
            .map((l) => ({
              id: l.id,
              householdId: l.householdId,
              origin: 'manual',
              title: l.title,
              sourceUrls: [l.url],
              facts: EMPTY_FACTS,
              conflicts: [],
              coordinates: null,
              evidence: [],
              photo: null,
              previousAskingPriceSek: null,
              observedAt: '2026-10-13T00:00:00Z',
              addedBy: owner,
              userTags: [],
            })),
          favorites: favorites
            .filter((f) => f.householdId === household)
            .map((f) => ({ ...f, savedAt: '2026-10-13T00:00:00Z' })),
        });
      }
      case 'hs_set_favorite': {
        if (!active(household, userId)) return noAccess();
        const target = listings.find(
          (l) => l.id === listing && l.householdId === household,
        );
        if (!target) return denied(400, 'P0001', 'Listing unavailable');
        const index = favorites.findIndex(
          (f) => f.listingId === listing && f.userId === userId,
        );
        if (args.p_saved && index < 0)
          favorites.push({
            householdId: household,
            listingId: listing,
            userId: userId as string,
          });
        if (!args.p_saved && index >= 0) favorites.splice(index, 1);
        return ok({ ok: true });
      }
      case 'hs_notes':
        if (!active(household, userId)) return noAccess();
        return ok(
          notes
            .filter(
              (n) => n.householdId === household && n.listingId === listing,
            )
            .map((n) => ({
              userId: n.userId,
              body: n.body,
              revision: n.revision,
              editedAt: '2026-10-13T00:00:00Z',
            })),
        );
      case 'hs_save_note': {
        if (!active(household, userId)) return noAccess();
        const target = listings.find(
          (l) => l.id === listing && l.householdId === household,
        );
        const revision = Number(args.p_revision);
        const own = notes.find(
          (n) =>
            n.householdId === household &&
            n.listingId === listing &&
            n.userId === userId,
        );
        if (!target)
          return denied(
            409,
            flaws.staleCode ?? '40001',
            'Note changed; reload',
          );
        if (revision === 0 && !own) {
          notes.push({
            householdId: household,
            listingId: listing,
            userId: userId as string,
            body: String(args.p_body),
            revision: 1,
          });
          return ok({ revision: 1 });
        }
        if (own && (flaws.noRevisionCheck || own.revision === revision)) {
          own.body = String(args.p_body);
          own.revision += 1;
          return ok({ revision: own.revision });
        }
        return denied(
          409,
          flaws.staleCode ?? '40001',
          'Note changed; reload before saving',
        );
      }
      default:
        return denied(404, 'PGRST202', `Could not find the function ${name}`);
    }
  }

  function callerFor(userId: string | null): Caller {
    return {
      rpc: async (name, args) => call(userId, name, args),
      rpcInHsSchema: async (name, args) =>
        flaws.hsSchemaExposed
          ? ok({ ran: name, args: Object.keys(args) })
          : denied(406, 'PGRST106', 'Invalid schema: hs'),
      readTable: async (_table, schema) =>
        schema === 'hs' && !flaws.hsSchemaExposed
          ? denied(406, 'PGRST106', 'Invalid schema: hs')
          : schema === 'hs'
            ? ok([{ leaked: true }])
            : denied(404, 'PGRST205', 'Could not find the table'),
    };
  }

  return {
    log,
    anon: () => callerFor(null),
    async signIn(label): Promise<SignInResult> {
      if (flaws.signInFails)
        return {
          ok: false,
          message: 'Sign-in failed (status 400, code invalid_credentials).',
        };
      return {
        ok: true,
        caller: callerFor(USER_IDS[label]),
        userId: USER_IDS[label],
      };
    },
  };
}
