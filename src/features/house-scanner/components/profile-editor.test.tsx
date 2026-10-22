// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ProfileEditor } from '@/features/house-scanner/components/profile-editor';
import { SYNTHETIC_SNAPSHOT } from '@/features/house-scanner/mock/synthetic-household';
import type { SearchProfile } from '@/features/house-scanner/types/contracts';
import { SEARCH_HUBS } from '@/features/house-scanner/utils/criteria-options';

beforeEach(() => {
  vi.stubGlobal(
    'matchMedia',
    (media: string): MediaQueryList => ({
      media,
      matches: false,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => true,
    }),
  );
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Element.prototype.scrollIntoView = () => {};
});
afterEach(cleanup);

const demo = SYNTHETIC_SNAPSHOT.profiles[0];

function profileWith(criteria: Partial<SearchProfile['criteria']>) {
  return { ...demo, criteria: { ...demo.criteria, ...criteria } };
}

function show(profile: SearchProfile, canEdit = true) {
  const onSave = vi.fn(async (_saved: SearchProfile) => {});
  render(
    <MantineProvider>
      <ProfileEditor profile={profile} canEdit={canEdit} onSave={onSave} />
    </MantineProvider>,
  );
  return onSave;
}

// A Mantine select opens when its input is clicked, and its options render in place under the input's listbox.
async function open(label: string) {
  const input = screen.getByRole('combobox', { name: label });
  fireEvent.click(input);
  await waitFor(() => expect(input.getAttribute('aria-expanded')).toBe('true'));
  const list = document.getElementById(
    input.getAttribute('aria-controls') ?? '',
  );
  if (!list) throw new Error(`No options for ${label}`);
  return within(list);
}

async function choose(label: string, option: string) {
  fireEvent.click((await open(label)).getByText(option));
}

async function save(onSave: ReturnType<typeof show>) {
  fireEvent.click(screen.getByRole('button', { name: 'Save criteria' }));
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  return onSave.mock.calls[0][0].criteria;
}

it('saves untouched criteria as they were, including values the form cannot show', async () => {
  // Between the steps, no maximum, a place the list does not know, the centre at Brunnsparken, no source list,
  // and nature and transit preferences the form no longer shows. Only apartments are searched, so the type narrows.
  const profile = profileWith({
    minAreaM2: 57,
    maxAreaM2: null,
    geography: { ...demo.criteria.geography, center: [11.97, 57.71] },
  });
  const onSave = show(profile);
  expect(screen.queryByRole('checkbox', { name: /glazed/i })).toBeNull();
  expect(
    screen.getByRole('combobox', { name: 'Minimum living area (m²)' }),
  ).toHaveProperty('value', '57 m²');
  expect(
    screen.getAllByText(/Your saved search includes Example municipality/)
      .length,
  ).toBeGreaterThan(0);
  expect(await save(onSave)).toEqual({
    ...profile.criteria,
    propertyTypes: ['apartment'],
  });
});

it('saves a hub, small radius, size, rooms and source, retaining the radius when switching locations', async () => {
  const onSave = show(profileWith({ sourceIds: ['boneo'] }));
  await choose('Minimum living area (m²)', '80 m²');
  await choose('Maximum living area (m²)', 'No maximum');
  await choose('Minimum rooms', '2,5 rooms');
  await choose('Search location', 'Centralstationen');
  await choose('Radius', '2 km');
  await choose('Search location', 'Göteborg (whole city)');
  await choose('Search location', 'Centralstationen');
  await choose('Sources', 'Lundin');
  expect(await save(onSave)).toMatchObject({
    minAreaM2: 80,
    maxAreaM2: null,
    minRooms: 2.5,
    sourceIds: ['boneo', 'lundin'],
    geography: {
      mode: 'radius',
      radiusKm: 2,
      center: [...SEARCH_HUBS[1].center],
      municipalities: ['Göteborg'],
    },
  });
});

it('saves a whole-city choice without replacing inactive coordinates', async () => {
  const onSave = show(
    profileWith({
      geography: { ...demo.criteria.geography, center: [12.5, 58.2] },
    }),
  );
  await choose('Search location', 'Göteborg (whole city)');
  expect((await save(onSave)).geography).toMatchObject({
    mode: 'municipalities',
    municipalities: ['Göteborg'],
    center: [12.5, 58.2],
  });
});

it('disables every dropdown for someone who is not an owner', () => {
  show(demo, false);
  for (const name of [
    'Minimum living area (m²)',
    'Maximum living area (m²)',
    'Minimum rooms',
    'Search location',
    'Sources',
  ])
    expect(screen.getByRole('combobox', { name })).toHaveProperty(
      'disabled',
      true,
    );
});
