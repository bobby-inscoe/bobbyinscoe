import type { IntlShape } from 'react-intl';
import type { MessageId } from '@/features/house-scanner/i18n/types/translations';

const labels: Record<string, MessageId> = {
  available: 'listings.details.available',
  upcoming: 'listings.details.upcoming',
  sold: 'listings.details.sold',
  withdrawn: 'listings.details.withdrawn',
  unknown: 'listings.details.unknown',
  apartment: 'listings.details.apartment',
  house: 'listings.details.house',
  ownership: 'listings.details.owned',
  cooperative: 'listings.details.cooperativeBostadsratt',
  rental: 'listings.details.rental',
  address: 'listings.details.address',
  building: 'listings.details.building',
  approximate_area: 'listings.details.approximateArea',
  user_supplied: 'listings.details.enteredByAMember',
  source_claim: 'listings.details.sourceClaim',
  buyer_observation: 'listings.details.buyerObservation',
  measurement: 'listings.details.measurement',
  model_interpretation: 'listings.details.modelInterpretation',
  facts: 'listings.details.facts',
  nearby_nature: 'listings.details.nearbyNature',
  nature_access: 'listings.details.natureAccess',
  green_outlook: 'listings.details.greenOutlook',
  privacy: 'listings.details.privacy',
  quietness: 'listings.details.quietness',
  transit: 'listings.details.transit',
  askingPriceSek: 'listings.details.askingPrice',
  baseFeeSek: 'listings.details.monthlyFee',
  livingAreaM2: 'listings.details.livingArea',
  secondaryAreaM2: 'listings.details.secondaryArea',
  rooms: 'listings.details.rooms',
  propertyType: 'listings.details.homeType',
  tenure: 'listings.details.tenure',
  status: 'listings.details.status',
  groundFloor: 'listings.details.floor',
  lift: 'listings.details.lift',
  liftServesHome: 'listings.details.liftServesHome',
  stepFree: 'listings.details.stepFree',
  outdoor: 'listings.details.outdoorSpace',
  glazed: 'listings.details.glazedOutdoorSpace',
  largePrivateTerrace: 'listings.details.largePrivateTerrace',
  municipality: 'listings.details.municipality',
  mandatoryMonthlySek: 'listings.details.mandatoryAdditions',
  purchase: 'listings.details.purchase',
  'Estimated from the street name (OpenStreetMap)':
    'listings.details.estimatedStreet',
  'Estimated from the address': 'listings.details.estimatedFromTheAddress',
  'Added by a household member': 'listings.details.enteredByAMember',
};

export function displayLabel(intl: IntlShape, value: string) {
  const id = labels[value];
  return id ? intl.formatMessage({ id }) : value;
}
