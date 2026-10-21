import {
  ActionIcon,
  Button,
  Group,
  NumberInput,
  Select,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core';
import { useState } from 'react';

import {
  type ManualSubmission,
  manualSubmissionSchema,
  type Snapshot,
} from '@/features/house-scanner/types/contracts';
import { normalizeManualUrl } from '@/features/house-scanner/utils/manual-url';

const asNumber = (value: number | string) =>
  typeof value === 'number' ? value : null;

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
  const [imageUrls, setImageUrls] = useState(['']);
  const [propertyType, setPropertyType] = useState<string | null>(null);
  const [outdoor, setOutdoor] = useState<string | null>(null);
  const [price, setPrice] = useState<number | string>('');
  const [area, setArea] = useState<number | string>('');
  const [rooms, setRooms] = useState<number | string>('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = manualSubmissionSchema.safeParse({
      url: url.trim(),
      title,
      note,
      imageUrls: imageUrls.map((value) => value.trim()).filter(Boolean),
      facts: {
        propertyType,
        outdoor,
        askingPriceSek: asNumber(price),
        livingAreaM2: asNumber(area),
        rooms: asNumber(rooms),
      },
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
      setImageUrls(['']);
      setPropertyType(null);
      setOutdoor(null);
      setPrice('');
      setArea('');
      setRooms('');
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
          Saves the link without opening the page. The title and note are shared
          with the household.
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
        <Text size="sm" fw={500}>
          Details you know (optional)
        </Text>
        <SimpleGrid cols={2}>
          <Select
            label="Type"
            data={[
              { value: 'apartment', label: 'Apartment' },
              { value: 'house', label: 'House' },
            ]}
            value={propertyType}
            onChange={setPropertyType}
            clearable
          />
          <Select
            label="Outdoor space"
            data={[
              { value: 'balcony', label: 'Balcony' },
              { value: 'terrace', label: 'Terrace' },
              { value: 'both', label: 'Balcony and terrace' },
              { value: 'none', label: 'None' },
            ]}
            value={outdoor}
            onChange={setOutdoor}
            clearable
          />
          <NumberInput
            label="Asking price (SEK)"
            value={price}
            onChange={setPrice}
            min={1}
            max={1_000_000_000}
            allowDecimal={false}
            thousandSeparator=" "
          />
          <NumberInput
            label="Living area (m²)"
            value={area}
            onChange={setArea}
            min={1}
            max={10000}
          />
          <NumberInput
            label="Rooms"
            value={rooms}
            onChange={setRooms}
            min={0.5}
            max={100}
            step={0.5}
          />
        </SimpleGrid>
        <Stack gap={4}>
          <Text size="sm" fw={500}>
            Photo link (optional)
          </Text>
          <Text size="xs" c="dimmed">
            Right-click a photo on the listing page and copy its image address.
            The photos stay on the original site.
          </Text>
          {imageUrls.map((value, index) => {
            const last = index === imageUrls.length - 1;
            return (
              // The list is only appended to or trimmed from the end, so the index is a stable key.
              // biome-ignore lint/suspicious/noArrayIndexKey: see above
              <Group key={index} gap="xs" wrap="nowrap">
                <TextInput
                  flex={1}
                  aria-label={`Photo link ${index + 1}`}
                  type="url"
                  value={value}
                  onChange={(event) =>
                    setImageUrls(
                      imageUrls.map((existing, at) =>
                        at === index ? event.currentTarget.value : existing,
                      ),
                    )
                  }
                  maxLength={2048}
                />
                <ActionIcon
                  variant="default"
                  size={36}
                  aria-label={
                    last ? 'Add another photo link' : 'Remove photo link'
                  }
                  disabled={last && (!value.trim() || imageUrls.length >= 10)}
                  onClick={() =>
                    setImageUrls(
                      last
                        ? [...imageUrls, '']
                        : imageUrls.filter((_, at) => at !== index),
                    )
                  }
                >
                  {last ? '+' : '−'}
                </ActionIcon>
              </Group>
            );
          })}
        </Stack>
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
