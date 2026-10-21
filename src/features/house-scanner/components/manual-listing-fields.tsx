import {
  ActionIcon,
  Group,
  NumberInput,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';

import type {
  Listing,
  ManualSubmission,
} from '@/features/house-scanner/types/contracts';

// What a member can enter besides the link, title and note: a few facts and up to ten photo links.
export interface ManualFieldsState {
  propertyType: string | null;
  outdoor: string | null;
  price: number | string;
  area: number | string;
  rooms: number | string;
  // Always at least one row; blank rows are dropped on submit.
  imageUrls: string[];
}

export const EMPTY_FIELDS: ManualFieldsState = {
  propertyType: null,
  outdoor: null,
  price: '',
  area: '',
  rooms: '',
  imageUrls: [''],
};

export function fieldsOf(listing: Listing): ManualFieldsState {
  const { facts } = listing;
  const urls = (listing.photos ?? (listing.photo ? [listing.photo] : [])).map(
    (photo) => photo.url,
  );
  return {
    propertyType: facts.propertyType,
    outdoor: facts.outdoor,
    price: facts.askingPriceSek ?? '',
    area: facts.livingAreaM2 ?? '',
    rooms: facts.rooms ?? '',
    imageUrls: urls.length ? urls : [''],
  };
}

const asNumber = (value: number | string) =>
  typeof value === 'number' ? value : null;

// The shape the schema checks; a bad value fails there, not here.
export const submissionOf = (
  fields: ManualFieldsState,
): Pick<ManualSubmission, 'imageUrls' | 'facts'> => ({
  imageUrls: fields.imageUrls.map((value) => value.trim()).filter(Boolean),
  facts: {
    propertyType:
      fields.propertyType as ManualSubmission['facts']['propertyType'],
    outdoor: fields.outdoor as ManualSubmission['facts']['outdoor'],
    askingPriceSek: asNumber(fields.price),
    livingAreaM2: asNumber(fields.area),
    rooms: asNumber(fields.rooms),
  },
});

export function ManualFields({
  fields,
  onChange,
}: {
  fields: ManualFieldsState;
  onChange: (fields: ManualFieldsState) => void;
}) {
  const { imageUrls } = fields;
  const setImageUrls = (next: string[]) =>
    onChange({ ...fields, imageUrls: next });
  return (
    <>
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
          value={fields.propertyType}
          onChange={(propertyType) => onChange({ ...fields, propertyType })}
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
          value={fields.outdoor}
          onChange={(outdoor) => onChange({ ...fields, outdoor })}
          clearable
        />
        <NumberInput
          label="Asking price (SEK)"
          value={fields.price}
          onChange={(price) => onChange({ ...fields, price })}
          min={1}
          max={1_000_000_000}
          allowDecimal={false}
          thousandSeparator=" "
        />
        <NumberInput
          label="Living area (m²)"
          value={fields.area}
          onChange={(area) => onChange({ ...fields, area })}
          min={1}
          max={10000}
        />
        <NumberInput
          label="Rooms"
          value={fields.rooms}
          onChange={(rooms) => onChange({ ...fields, rooms })}
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
    </>
  );
}
