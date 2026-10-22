import { Button, Stack, Text, Textarea, TextInput, Title } from '@mantine/core';
import { useState } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import {
  EMPTY_FIELDS,
  ManualFields,
  submissionOf,
} from '@/features/house-scanner/components/manual-listing-fields';
import {
  errorFeedback,
  type Feedback,
  formatFeedback,
  validationFeedback,
} from '@/features/house-scanner/i18n/catalogs';
import {
  type ManualSubmission,
  manualSubmissionSchema,
  type Snapshot,
} from '@/features/house-scanner/types/contracts';
import { normalizeManualUrl } from '@/features/house-scanner/utils/manual-url';

export function ManualListingForm({
  snapshot,
  onAdd,
  onExisting,
}: {
  snapshot: Snapshot;
  onAdd?: (submission: ManualSubmission) => Promise<void>;
  onExisting: (id: string) => void;
}) {
  const intl = useIntl();

  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [fields, setFields] = useState(EMPTY_FIELDS);
  const [message, setMessage] = useState<Feedback>('');
  const [busy, setBusy] = useState(false);
  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = manualSubmissionSchema.safeParse({
      url: url.trim(),
      title,
      note,
      ...submissionOf(fields),
    });
    if (!result.success) {
      setMessage(validationFeedback(result.error.issues));
      return;
    }
    if (!onAdd) return;
    const normalized = normalizeManualUrl(result.data.url);
    const existing = snapshot.listings.find((listing) =>
      listing.sourceUrls.some(
        (sourceUrl) => normalizeManualUrl(sourceUrl) === normalized,
      ),
    );
    if (existing) {
      setMessage('listings.addLink.thisLinkAlreadyExistsItsDetailsAreSelected');
      onExisting(existing.id);
      return;
    }
    setBusy(true);
    try {
      await onAdd({ ...result.data, url: normalized });
      setUrl('');
      setTitle('');
      setNote('');
      setFields(EMPTY_FIELDS);
      setMessage('listings.addLink.linkAddedSaveItSeparatelyIfYouWantIt');
    } catch (error) {
      setMessage(errorFeedback(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} noValidate>
      <Stack maw="36rem">
        <Title order={2}>
          <FormattedMessage id="listings.addLink.addAListingLink" />
        </Title>
        <Text size="sm" c="dimmed">
          <FormattedMessage id="listings.addLink.savesTheLinkWithoutOpeningThePageTheTitle" />
        </Text>
        <TextInput
          label={intl.formatMessage({ id: 'listings.addLink.listingLink' })}
          type="url"
          required
          value={url}
          onChange={(event) => setUrl(event.currentTarget.value)}
          maxLength={2048}
        />
        <TextInput
          label={intl.formatMessage({ id: 'listings.addLink.titleOptional' })}
          value={title}
          onChange={(event) => setTitle(event.currentTarget.value)}
          maxLength={200}
        />
        <Textarea
          label={intl.formatMessage({
            id: 'listings.addLink.sharedNoteOptional',
          })}
          value={note}
          onChange={(event) => setNote(event.currentTarget.value)}
          maxLength={2000}
        />
        <ManualFields fields={fields} onChange={setFields} />
        <Button type="submit" loading={busy} disabled={!onAdd}>
          <FormattedMessage id="listings.addLink.addLink" />
        </Button>
        {!onAdd && (
          <Text size="sm">
            <FormattedMessage id="listings.addLink.manualAdditionsAreUnavailableInThisView" />
          </Text>
        )}
        <Text role="status">{formatFeedback(intl, message)}</Text>
      </Stack>
    </form>
  );
}
