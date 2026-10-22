import type { MessageId } from '@/features/house-scanner/i18n/types/translations';

declare global {
  namespace FormatjsIntl {
    interface Message {
      ids: MessageId;
    }
  }
}
