import { Avatar, NativeSelect, Stack, Text } from '@mantine/core';
import { FormattedMessage, useIntl } from 'react-intl';
import englishFlag from '@/features/house-scanner/assets/flags/gb.svg';
import swedishFlag from '@/features/house-scanner/assets/flags/se.svg';
import { useLanguage } from '@/features/house-scanner/i18n/language-provider';

const languages = [
  { value: 'en', label: 'English', flag: englishFlag },
  { value: 'sv', label: 'Svenska', flag: swedishFlag },
];
export function LanguageSelect({ label = false }: { label?: boolean }) {
  const intl = useIntl();
  const { language, setLanguage, saved } = useLanguage();
  return (
    <Stack
      gap={4}
      w={label ? { base: '100%', xs: 240 } : 145}
      maw="100%"
      miw={0}
    >
      <NativeSelect
        label={
          label ? intl.formatMessage({ id: 'navigation.language' }) : undefined
        }
        aria-label={intl.formatMessage({ id: 'navigation.language' })}
        value={language}
        onChange={(event) => {
          const value = event.currentTarget.value;
          if (value === 'en' || value === 'sv') setLanguage(value);
        }}
        data={languages}
        w="100%"
        maw="100%"
        miw={0}
        size={label ? 'sm' : 'xs'}
        leftSection={
          <Avatar
            src={language === 'sv' ? swedishFlag : englishFlag}
            size={20}
            radius="xl"
            alt=""
            aria-hidden
          />
        }
      />
      {!saved && (
        <Text size="xs" role="status" maw={240}>
          <FormattedMessage id="navigation.languageNotSaved" />
        </Text>
      )}
    </Stack>
  );
}
