import { Button, Group, Paper, Stack, Text, TextInput } from '@mantine/core';
import { createContext, useContext, useState } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import {
  fieldsOf,
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
  type Listing,
  type ManualEdit,
  manualEditSchema,
} from '@/features/house-scanner/types/contracts';

interface ManualActions {
  onUpdate: (listingId: string, edit: ManualEdit) => Promise<void>;
  onDelete: (listingId: string) => Promise<void>;
}

// Details are drawn in three places, so the actions come by context, not through every layer.
const ManualActionsContext = createContext<ManualActions | null>(null);
export const ManualActionsProvider = ManualActionsContext.Provider;

const errorText = errorFeedback;

// Edit and delete for a listing a member added by link. Any member of the household may use them.
export function ManualListingActions({ listing }: { listing: Listing }) {
  const intl = useIntl();

  const actions = useContext(ManualActionsContext);
  const [mode, setMode] = useState<'view' | 'edit' | 'confirm'>('view');
  const [title, setTitle] = useState('');
  const [fields, setFields] = useState(() => fieldsOf(listing));
  const [message, setMessage] = useState<Feedback>('');
  const [busy, setBusy] = useState(false);
  if (listing.origin !== 'manual' || !actions) return null;

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setMessage('');
    try {
      await action();
      setMode('view');
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  const save = (event: React.SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = manualEditSchema.safeParse({
      title,
      ...submissionOf(fields),
    });
    if (!result.success) {
      setMessage(validationFeedback(result.error.issues));
      return;
    }
    void run(() => actions.onUpdate(listing.id, result.data));
  };

  if (mode === 'edit')
    return (
      <form onSubmit={save} noValidate>
        <Stack maw="36rem" gap="sm">
          <TextInput
            label={intl.formatMessage({ id: 'listings.details.title' })}
            value={title}
            onChange={(event) => setTitle(event.currentTarget.value)}
            maxLength={200}
          />
          <ManualFields fields={fields} onChange={setFields} />
          <Group>
            <Button type="submit" loading={busy}>
              <FormattedMessage id="listings.details.saveChanges" />
            </Button>
            <Button
              variant="default"
              disabled={busy}
              onClick={() => {
                setMode('view');
                setMessage('');
              }}
            >
              <FormattedMessage id="common.cancel" />
            </Button>
          </Group>
          <Text role="status">{formatFeedback(intl, message)}</Text>
        </Stack>
      </form>
    );
  if (mode === 'confirm')
    return (
      <Paper
        withBorder
        p="sm"
        role="alertdialog"
        aria-label={intl.formatMessage({
          id: 'listings.details.deleteListing',
        })}
      >
        <Stack gap="xs">
          <Text size="sm">
            <FormattedMessage id="listings.details.deleteThisLinkForTheWholeHouseholdEveryoneS" />
          </Text>
          <Group>
            <Button
              color="red"
              loading={busy}
              onClick={() => void run(() => actions.onDelete(listing.id))}
            >
              <FormattedMessage id="common.delete" />
            </Button>
            <Button
              variant="default"
              disabled={busy}
              onClick={() => {
                setMode('view');
                setMessage('');
              }}
            >
              <FormattedMessage id="listings.details.keepIt" />
            </Button>
          </Group>
          <Text role="status">{formatFeedback(intl, message)}</Text>
        </Stack>
      </Paper>
    );
  return (
    <Group gap="xs">
      <Button
        size="compact-sm"
        variant="default"
        onClick={() => {
          setTitle(listing.title);
          setFields(fieldsOf(listing));
          setMode('edit');
        }}
      >
        <FormattedMessage id="common.edit" />
      </Button>
      <Button
        size="compact-sm"
        variant="default"
        color="red"
        onClick={() => setMode('confirm')}
      >
        <FormattedMessage id="common.delete" />
      </Button>
    </Group>
  );
}
