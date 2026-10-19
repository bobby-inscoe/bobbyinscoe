import { Button, Stack, Text, Textarea, TextInput, Title } from '@mantine/core';
import { useState } from 'react';

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
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [tags, setTags] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = manualSubmissionSchema.safeParse({
      url: url.trim(),
      title,
      note,
      tags: tags
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
    });
    if (!result.success) {
      setMessage(result.error.issues.map((issue) => issue.message).join(' '));
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
      setMessage('This link already exists. Its details are selected.');
      onExisting(existing.id);
      return;
    }
    setBusy(true);
    try {
      await onAdd({ ...result.data, url: normalized });
      setUrl('');
      setTitle('');
      setNote('');
      setTags('');
      setMessage('Link added. Save it separately if you want it in Favorites.');
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Could not add the link. Try again.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit}>
      <Stack maw="36rem">
        <Title order={2}>Add a listing link</Title>
        <Text size="sm" c="dimmed">
          Bookmarks the page without fetching it. Notes are shared with the
          household.
        </Text>
        <TextInput
          label="Listing link"
          type="url"
          required
          value={url}
          onChange={(event) => setUrl(event.currentTarget.value)}
          maxLength={2048}
        />
        <TextInput
          label="Title (optional)"
          value={title}
          onChange={(event) => setTitle(event.currentTarget.value)}
          maxLength={200}
        />
        <Textarea
          label="Shared note (optional)"
          value={note}
          onChange={(event) => setNote(event.currentTarget.value)}
          maxLength={2000}
        />
        <TextInput
          label="User tags (optional, comma separated)"
          value={tags}
          onChange={(event) => setTags(event.currentTarget.value)}
          description="Up to ten tags, forty characters each."
        />
        <Button type="submit" loading={busy} disabled={!onAdd}>
          Add link
        </Button>
        {!onAdd && (
          <Text size="sm">Manual additions are unavailable in this view.</Text>
        )}
        <Text role="status">{message}</Text>
      </Stack>
    </form>
  );
}
