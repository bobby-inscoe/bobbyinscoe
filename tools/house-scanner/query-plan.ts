import { capabilitySchema } from '@house-scanner-tools/source-registry';
import { z } from 'zod';
import { criteriaSchema } from '@/features/house-scanner/types/contracts';

export const planningProfileSchema = z.strictObject({
  id: z.uuid(),
  revision: z.number().int().positive(),
  enabled: z.boolean(),
  criteria: criteriaSchema,
});
export const queryPlanInputSchema = z.strictObject({
  profiles: z.array(planningProfileSchema).min(1).max(20),
  capability: capabilitySchema,
  collectionPriceCapSek: z
    .number()
    .int()
    .positive()
    .max(1_000_000_000)
    .nullable(),
  maxPartitions: z.number().int().min(1).max(100),
});

export function planQueries(input: z.input<typeof queryPlanInputSchema>) {
  const { profiles, capability, collectionPriceCapSek, maxPartitions } =
    queryPlanInputSchema.parse(input);
  const enabled = profiles.filter((profile) => profile.enabled);
  if (enabled.length === 0)
    throw new Error('At least one enabled profile is required.');
  if (new Set(profiles.map((profile) => profile.id)).size !== profiles.length)
    throw new Error('Profile IDs must be unique.');
  const municipalities = [
    ...new Set(
      enabled.flatMap((profile) => profile.criteria.geography.municipalities),
    ),
  ].sort();
  const propertyTypes = [
    ...new Set(enabled.flatMap((profile) => profile.criteria.propertyTypes)),
  ].sort();
  const gaps = [...capability.policy.capabilities.coverageGaps];
  gaps.push(
    'Municipality partitions do not establish coverage of the full center/radius scope, including areas outside named municipalities.',
  );
  const requiredPriceCap = Math.max(
    ...enabled.map((profile) => profile.criteria.stretchPriceSek),
  );
  if (collectionPriceCapSek !== null) {
    gaps.push(
      `A requested cap of SEK ${collectionPriceCapSek} would omit higher prices; native price filtering is unverified and this cap is not applied.`,
    );
    if (collectionPriceCapSek < requiredPriceCap)
      gaps.push(
        'The requested cap does not cover the union of enabled profile stretch budgets.',
      );
  }
  if (!capability.policy.capabilities.unknownPrice)
    gaps.push('Unknown-price inventory is not covered.');
  if (!capability.policy.capabilities.upcoming)
    gaps.push('Upcoming inventory is not covered.');
  if (!capability.policy.capabilities.knownListingRefresh)
    gaps.push('Known listings outside discovery cannot be refreshed.');
  if (!capability.policy.capabilities.pagination)
    gaps.push('Pagination completeness is unverified.');
  if (municipalities.length > maxPartitions)
    gaps.push('The partition ceiling omits some municipalities.');
  if (capability.geographicPartitioning === 'unverified')
    gaps.push('Geographic filter equivalence is unverified.');
  const areas = enabled.map((profile) => profile.criteria.maxAreaM2);
  return {
    version: 1 as const,
    sourceId: capability.policy.sourceId,
    permission:
      capability.policy.status === 'approved' &&
      capability.policy.automatedCollection &&
      capability.policy.privateDisplay
        ? ('policy-check-required' as const)
        : ('denied-no-permission' as const),
    profileVersions: enabled
      .map(({ id, revision }) => ({ profileId: id, revision }))
      .sort((left, right) => left.profileId.localeCompare(right.profileId)),
    envelope: {
      propertyTypes,
      purchase: true,
      minAreaM2: Math.min(
        ...enabled.map((profile) => profile.criteria.minAreaM2),
      ),
      maxAreaM2: areas.includes(null)
        ? null
        : Math.max(...areas.map((area) => area ?? 0)),
      minRooms: Math.min(
        ...enabled.map((profile) => profile.criteria.minRooms),
      ),
      requiredPriceCapSek: requiredPriceCap,
      requestedPriceCapSek: collectionPriceCapSek,
      effectiveNativePriceCapSek: null,
      geography: enabled.map((profile) => profile.criteria.geography),
    },
    // Broad queries retain unknown dimensions and exceptions; local matching owns criteria.
    nativeNumericFilters: null,
    partitions: municipalities
      .slice(0, maxPartitions)
      .map((municipality, index) => ({
        id: `municipality-${index + 1}`,
        municipality,
        propertyTypes,
        includeUnknownPrice: true,
        includeUpcoming: true,
        resultCap: capability.policy.capabilities.resultCap,
        cursor: null,
        completion: 'not-executed' as const,
      })),
    gaps,
  };
}
