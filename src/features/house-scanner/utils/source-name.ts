import { SOURCES } from '@/features/house-scanner/utils/criteria-options';

const SOURCE_IDS: Record<string, string> = {
  'bjurfors.se': 'bjurfors',
  'boneo.se': 'boneo',
  'erikolsson.se': 'erik-olsson',
  'husmanhagberg.se': 'husman-hagberg',
  'lundin.se': 'lundin',
  'stadshem.se': 'stadshem',
  'svenskfast.se': 'svenskfast',
};

export function sourceName(host: string): string {
  const domain = host.replace(/^www\./, '');
  return (
    SOURCES.find(({ value }) => value === SOURCE_IDS[domain])?.label ?? host
  );
}
