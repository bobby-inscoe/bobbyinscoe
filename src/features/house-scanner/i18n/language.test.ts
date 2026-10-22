import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LANGUAGE_KEY,
  readLanguage,
  saveLanguage,
} from '@/features/house-scanner/i18n/language';

afterEach(() => vi.unstubAllGlobals());
describe('language preference', () => {
  it.each([null, '', 'en', 'de', 'sv-SE', 'EN'])(
    'defaults %s to English',
    (value) => {
      vi.stubGlobal('localStorage', { getItem: () => value });
      expect(readLanguage()).toBe('en');
    },
  );
  it('reads Swedish and stores only the language preference', () => {
    const setItem = vi.fn();
    vi.stubGlobal('localStorage', { getItem: () => 'sv', setItem });
    expect(readLanguage()).toBe('sv');
    expect(saveLanguage('sv')).toBe(true);
    expect(setItem).toHaveBeenCalledExactlyOnceWith(LANGUAGE_KEY, 'sv');
  });
  it('survives blocked reads and writes', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    expect(readLanguage()).toBe('en');
    expect(saveLanguage('sv')).toBe(false);
  });
});
