import { Button, Group, Paper, Stack, Text, TextInput } from '@mantine/core';
import { createContext, useContext, useState } from 'react';

import {
  fieldsOf,
  ManualFields,
  submissionOf,
} from '@/features/house-scanner/components/manual-listing-fields';
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

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : 'Something went wrong. Try again.';

// Edit and delete for a listing a member added by link. Any member of the household may use them.
export function ManualListingActions({ listing }: { listing: Listing }) {
  const actions = useContext(ManualActionsContext);
  const [mode, setMode] = useState<'view' | 'edit' | 'confirm'>('view');
  const [title, setTitle] = useState('');
  const [fields, setFields] = useState(() => fieldsOf(listing));
  const [message, setMessage] = useState('');
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
      setMessage(result.error.issues.map((issue) => issue.message).join(' '));
      return;
    }
    void run(() => actions.onUpdate(listing.id, result.data));
  };

  if (mode === 'edit')
    return (
      <form onSubmit={save}>
        <Stack maw="36rem" gap="sm">
          <TextInput
            label="Title"
            value={title}
            onChange={(event) => setTitle(event.currentTarget.value)}
            maxLength={200}
          />
          <ManualFields fields={fields} onChange={setFields} />
          <Group>
            <Button type="submit" loading={busy}>
              Save changes
            </Button>
            <Button
              variant="default"
              disabled={busy}
              onClick={() => {
                setMode('view');
                setMessage('');
              }}
            >
              Cancel
            </Button>
          </Group>
          <Text role="status">{message}</Text>
        </Stack>
      </form>
    );
  if (mode === 'confirm')
    return (
      <Paper withBorder p="sm" role="alertdialog" aria-label="Delete listing">
        <Stack gap="xs">
          <Text size="sm">
            Delete this link for the whole household? Everyone's favorites and
            notes on it are removed too.
          </Text>
          <Group>
            <Button
              color="red"
              loading={busy}
              onClick={() => void run(() => actions.onDelete(listing.id))}
            >
              Delete
            </Button>
            <Button
              variant="default"
              disabled={busy}
              onClick={() => {
                setMode('view');
                setMessage('');
              }}
            >
              Keep it
            </Button>
          </Group>
          <Text role="status">{message}</Text>
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
        Edit
      </Button>
      <Button
        size="compact-sm"
        variant="default"
        color="red"
        onClick={() => setMode('confirm')}
      >
        Delete
      </Button>
    </Group>
  );
}
