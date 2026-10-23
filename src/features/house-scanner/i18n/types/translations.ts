import type { AccessTranslations } from '@/features/house-scanner/i18n/types/access';
import type { CommonTranslations } from '@/features/house-scanner/i18n/types/common';
import type { ErrorsTranslations } from '@/features/house-scanner/i18n/types/errors';
import type { ListingsTranslations } from '@/features/house-scanner/i18n/types/listings';
import type { NavigationTranslations } from '@/features/house-scanner/i18n/types/navigation';
import type { SettingsTranslations } from '@/features/house-scanner/i18n/types/settings';
import type { ValidationTranslations } from '@/features/house-scanner/i18n/types/validation';
import type { ViewingsTranslations } from '@/features/house-scanner/i18n/types/viewings';

export interface Translations {
  feedback: {
    label: string;
    hint: string;
    intro: string;
    type: string;
    bug: string;
    feature: string;
    title: string;
    description: string;
    bugHelp: string;
    featureHelp: string;
    screenshot: string;
    imageHelp: string;
    remove: string;
    privacy: string;
    send: string;
    cancel: string;
    success: string;
    error: string;
    invalid: string;
  };
  settings: SettingsTranslations;
  listings: ListingsTranslations;
  access: AccessTranslations;
  common: CommonTranslations;
  navigation: NavigationTranslations;
  viewings: ViewingsTranslations;
  errors: ErrorsTranslations;
  validation: ValidationTranslations;
}

type LeafPaths<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${LeafPaths<T[K]>}`;
}[keyof T & string];
export type MessageId = LeafPaths<Translations>;
