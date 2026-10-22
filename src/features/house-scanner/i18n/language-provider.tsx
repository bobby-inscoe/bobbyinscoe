import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from 'react';
import { IntlProvider } from 'react-intl';
import { catalogs } from '@/features/house-scanner/i18n/catalogs';
import {
  type Language,
  locales,
  readLanguage,
  saveLanguage,
} from '@/features/house-scanner/i18n/language';

const LanguageContext = createContext<{
  language: Language;
  setLanguage: (language: Language) => void;
  saved: boolean;
} | null>(null);

export function ShellterLanguageProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [language, setCurrentLanguage] = useState(readLanguage);
  const [saved, setSaved] = useState(true);
  useEffect(() => {
    const previous = document.documentElement.lang;
    return () => {
      document.documentElement.lang = previous;
    };
  }, []);
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);
  function setLanguage(next: Language) {
    setCurrentLanguage(next);
    setSaved(saveLanguage(next));
  }
  return (
    <LanguageContext value={{ language, setLanguage, saved }}>
      <IntlProvider
        locale={locales[language]}
        defaultLocale="en-GB"
        timeZone="Europe/Stockholm"
        messages={catalogs[language]}
      >
        {children}
      </IntlProvider>
    </LanguageContext>
  );
}

export function useLanguage() {
  const value = useContext(LanguageContext);
  if (!value)
    throw new Error('Language control requires ShellterLanguageProvider.');
  return value;
}
