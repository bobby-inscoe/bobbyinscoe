// Obviously fictional criteria in the shape hs.valid_criteria accepts. They
// carry no real preference: a zero-degree center, a made-up municipality and
// round numbers.
export const FICTIONAL_CRITERIA = {
  minAreaM2: 50,
  maxAreaM2: null,
  minRooms: 2,
  preferredPriceSek: 2_000_000,
  stretchPriceSek: 3_000_000,
  propertyTypes: ['apartment', 'house'],
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

export function seedSql(): string {
  const criteria = JSON.stringify(FICTIONAL_CRITERIA);
  return `-- FICTIONAL TEST DATA for the House Scanner hosted acceptance run.
-- Run in the Supabase SQL editor as postgres, after migrations 0001 to 0003 and
-- after creating the test users in the dashboard (Authentication, Users).
-- Replace each <...> placeholder with the user's UUID from that page.
-- One statement, so a failure leaves nothing half created.
-- No listing is seeded here. The acceptance script adds one manual bookmark per
-- household through hs_add_manual, the supported path for a non-operator.

do $$
declare
  user_a uuid := '<USER A UUID>';
  user_b uuid := '<USER B UUID>';
  criteria jsonb := '${criteria}'::jsonb;
begin
  perform hs.admin_bootstrap_household('FICTIONAL acceptance household A', user_a, 'FICTIONAL owner A', 'FICTIONAL profile A', criteria);
  perform hs.admin_bootstrap_household('FICTIONAL acceptance household B', user_b, 'FICTIONAL owner B', 'FICTIONAL profile B', criteria);
end $$;

-- Optional, for the second member of household A (HS_ACCEPT_A2_*). Remove the leading -- from each line.
-- select hs.admin_set_member(m.household_id, '<USER A2 UUID>', 'FICTIONAL member A2', 'member', true)
--   from hs.members m where m.user_id = '<USER A UUID>';

-- Optional, only for check 7. Deactivate A2, then run the script with --a2-deactivated.
-- select hs.admin_set_member(m.household_id, '<USER A2 UUID>', 'FICTIONAL member A2', 'member', false)
--   from hs.members m where m.user_id = '<USER A UUID>';
`;
}
