import type {
  Criteria,
  Listing,
} from '@/features/house-scanner/types/contracts';

// One set of cases for the hard rules that both the client matcher and the database candidate filter apply
// (hs.fails_hard_rule, latest in supabase/migrations/*_house_scanner_shared_hides.sql). A case marked `excluded` must be outside for both;
// every other case must be returned by the database. Geography and the apartment rules stay client-only.
export const HARD_RULE_CRITERIA: Pick<
  Criteria,
  'minAreaM2' | 'maxAreaM2' | 'minRooms' | 'stretchPriceSek' | 'propertyTypes'
> = {
  minAreaM2: 60,
  maxAreaM2: 120,
  minRooms: 2,
  stretchPriceSek: 4_000_000,
  propertyTypes: ['apartment'],
};

export const HARD_RULE_CASES: {
  name: string;
  facts: Partial<Listing['facts']>;
  conflicts?: Listing['conflicts'];
  // The listing's source, and the sources the criteria select; absent means no source filter.
  sourceId?: string;
  sourceIds?: string[];
  excluded: boolean;
}[] = [
  { name: 'fits every rule', facts: {}, excluded: false },
  {
    name: 'source not selected',
    facts: {},
    sourceId: 'beta',
    sourceIds: ['alpha'],
    excluded: true,
  },
  {
    name: 'source selected',
    facts: {},
    sourceId: 'alpha',
    sourceIds: ['alpha'],
    excluded: false,
  },
  { name: 'no source filter', facts: {}, sourceId: 'beta', excluded: false },
  {
    name: 'no source, as a manual listing',
    facts: {},
    sourceIds: ['alpha'],
    excluded: false,
  },
  {
    name: 'area below the minimum',
    facts: { livingAreaM2: 59 },
    excluded: true,
  },
  { name: 'area at the minimum', facts: { livingAreaM2: 60 }, excluded: false },
  {
    name: 'area above the maximum',
    facts: { livingAreaM2: 121 },
    excluded: true,
  },
  { name: 'area unknown', facts: { livingAreaM2: null }, excluded: false },
  {
    name: 'area disputed',
    facts: { livingAreaM2: 30 },
    conflicts: ['livingAreaM2'],
    excluded: false,
  },
  { name: 'too few rooms', facts: { rooms: 1.5 }, excluded: true },
  { name: 'rooms unknown', facts: { rooms: null }, excluded: false },
  {
    name: 'price above the stretch budget',
    facts: { askingPriceSek: 4_000_001 },
    excluded: true,
  },
  {
    name: 'price at the stretch budget',
    facts: { askingPriceSek: 4_000_000 },
    excluded: false,
  },
  { name: 'price unknown', facts: { askingPriceSek: null }, excluded: false },
  {
    name: 'price disputed',
    facts: { askingPriceSek: 9_000_000 },
    conflicts: ['askingPriceSek'],
    excluded: false,
  },
  { name: 'a house', facts: { propertyType: 'house' }, excluded: true },
  { name: 'type unknown', facts: { propertyType: null }, excluded: false },
  { name: 'a rental', facts: { tenure: 'rental' }, excluded: true },
  {
    name: 'tenure disputed',
    facts: { tenure: 'rental' },
    conflicts: ['tenure'],
    excluded: false,
  },
  { name: 'not for purchase', facts: { purchase: false }, excluded: true },
  { name: 'sold', facts: { status: 'sold' }, excluded: true },
  { name: 'withdrawn', facts: { status: 'withdrawn' }, excluded: true },
  {
    name: 'status disputed',
    facts: { status: 'sold' },
    conflicts: ['status'],
    excluded: false,
  },
];

// The facts every case starts from: a known apartment that passes every hard rule and every client-only rule.
export const HARD_RULE_BASE_FACTS: Listing['facts'] = {
  propertyType: 'apartment',
  tenure: 'cooperative',
  purchase: true,
  livingAreaM2: 80,
  secondaryAreaM2: null,
  rooms: 3,
  askingPriceSek: 3_000_000,
  groundFloor: false,
  lift: true,
  liftServesHome: null,
  stepFree: null,
  outdoor: 'balcony',
  glazed: true,
  largePrivateTerrace: null,
  municipality: 'Göteborg',
  baseFeeSek: null,
  mandatoryMonthlySek: null,
  status: 'available',
};
