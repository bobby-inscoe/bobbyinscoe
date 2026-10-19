import type {
  Observation,
  SourcePolicy,
} from '@/features/house-scanner/types/contracts';

export function assertSourceAllowed(policy: SourcePolicy, now: Date): void {
  if (
    policy.status !== 'approved' ||
    !policy.automatedCollection ||
    !policy.privateDisplay ||
    Date.parse(policy.reviewDueAt) <= now.getTime() ||
    Date.parse(policy.reviewedAt) > now.getTime()
  ) {
    throw new Error('Source permission is absent, expired or insufficient.');
  }
}

export function assertObservationAllowed(
  policy: SourcePolicy,
  observation: Observation,
  now: Date,
): void {
  assertSourceAllowed(policy, now);
  if (observation.coordinates?.precision === 'user_supplied')
    throw new Error('Source ingestion cannot claim user-supplied coordinates.');
  if (!policy.listingOrigins.includes(new URL(observation.sourceUrl).origin))
    throw new Error('Listing origin is not approved.');
  const observedTimes = [
    observation.observedAt,
    ...(observation.photo ? [observation.photo.observedAt] : []),
    ...(observation.coordinates ? [observation.coordinates.observedAt] : []),
    ...observation.evidence.map((evidence) => evidence.observedAt),
  ];
  if (
    observedTimes.some(
      (timestamp) =>
        Date.parse(timestamp) > now.getTime() + 300000 ||
        Date.parse(timestamp) < now.getTime() - policy.retentionDays * 86400000,
    )
  )
    throw new Error('Observation is outside the permitted time window.');
  for (const [key, value] of Object.entries(observation.facts)) {
    if (
      value !== null &&
      value !== 'unknown' &&
      !policy.allowedFactFields.some((field) => field === key)
    )
      throw new Error('Observation includes an unapproved fact field.');
  }
  if (observation.viewings?.length && policy.viewings !== true)
    throw new Error('Viewing times are not approved for this source.');
  if (
    observation.photo &&
    (!policy.imageDisplay ||
      !policy.imageHotlink ||
      !policy.imageOrigins.includes(new URL(observation.photo.url).origin) ||
      Date.parse(observation.photo.expiresAt) <= now.getTime())
  )
    throw new Error('Photo permission is absent or expired.');
  if (
    observation.evidence.some(
      (e) =>
        !['source_claim', 'measurement'].includes(e.kind) ||
        !policy.allowedEvidenceSubjects.includes(e.subject) ||
        (e.sourceUrl !== null &&
          !policy.listingOrigins.includes(new URL(e.sourceUrl).origin)),
    )
  )
    throw new Error(
      'Evidence provenance or rights are not approved for source ingestion.',
    );
}
