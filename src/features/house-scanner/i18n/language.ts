export type Language = 'en' | 'sv';
export const LANGUAGE_KEY = 'shellter.language';
export const locales = { en: 'en-GB', sv: 'sv-SE' } as const;
export function readLanguage(): Language {
  try {
    return localStorage.getItem(LANGUAGE_KEY) === 'en' ? 'en' : 'sv';
  } catch {
    return 'sv';
  }
}
export function saveLanguage(language: Language): boolean {
  try {
    localStorage.setItem(LANGUAGE_KEY, language);
    return true;
  } catch {
    return false;
  }
}
