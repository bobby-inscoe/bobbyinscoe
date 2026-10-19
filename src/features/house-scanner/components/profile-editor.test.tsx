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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CriteriaHelp } from '@/features/house-scanner/components/criteria-help';
import { ProfileEditor } from '@/features/house-scanner/components/profile-editor';
import { SettingsPanel } from '@/features/house-scanner/components/settings-panel';
import {
  DEMO_USER_ID,
  SYNTHETIC_SNAPSHOT,
} from '@/features/house-scanner/mock/synthetic-household';
import type { SearchProfile } from '@/features/house-scanner/types/contracts';
import { BRUNNSPARKEN } from '@/features/house-scanner/utils/criteria-options';

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

describe('size and room dropdowns', () => {
  it('shows the saved values, formatted', () => {
    show(demo);
    expect(
      screen.getByRole('combobox', { name: 'Minimum living area (m²)' }),
    ).toHaveProperty('value', '60 m²');
    expect(
      screen.getByRole('combobox', { name: 'Maximum living area (m²)' }),
    ).toHaveProperty('value', '100 m²');
    expect(
      screen.getByRole('combobox', { name: 'Minimum rooms' }),
    ).toHaveProperty('value', '2 rooms');
    expect(screen.getByRole('combobox', { name: 'Radius' })).toHaveProperty(
      'value',
      '20 km',
    );
  });

  it('saves a chosen size, room count and radius, and "No maximum" as no limit', async () => {
    const onSave = show(demo);
    await choose('Minimum living area (m²)', '80 m²');
    await choose('Maximum living area (m²)', 'No maximum');
    await choose('Minimum rooms', '2,5 rooms');
    await choose('Radius', '30 km');
    expect(await save(onSave)).toMatchObject({
      minAreaM2: 80,
      maxAreaM2: null,
      minRooms: 2.5,
      geography: { radiusKm: 30 },
    });
  });

  it('keeps a saved value that is between the steps, and saves it unchanged', async () => {
    const onSave = show(profileWith({ minAreaM2: 57, maxAreaM2: null }));
    expect(
      screen.getByRole('combobox', { name: 'Minimum living area (m²)' }),
    ).toHaveProperty('value', '57 m²');
    expect(
      screen.getByRole('combobox', { name: 'Maximum living area (m²)' }),
    ).toHaveProperty('value', 'No maximum');
    expect(await save(onSave)).toMatchObject({
      minAreaM2: 57,
      maxAreaM2: null,
    });
  });

  it.each(['Minimum living area (m²)', 'Minimum rooms'])(
    'offers no way to clear %s',
    async (label) => {
      show(demo);
      const options = await open(label);
      expect(
        options.getAllByRole('option', { hidden: true }).length,
      ).toBeGreaterThan(5);
      expect(options.queryByText('Any')).toBeNull();
      expect(options.queryByText('No maximum')).toBeNull();
    },
  );

  it('offers "No maximum" for the maximum area only', async () => {
    show(demo);
    expect(
      (await open('Maximum living area (m²)')).getByText('No maximum'),
    ).toBeTruthy();
  });
});

describe('places and the search circle', () => {
  it('lists Göteborg as pickable and Mölndal as coming soon and disabled', async () => {
    show(
      profileWith({
        geography: { ...demo.criteria.geography, municipalities: ['Göteborg'] },
      }),
    );
    const places = await open('Places to search');
    const coming = places
      .getByText('Mölndal (coming soon)')
      .closest('[role=option]');
    expect(coming?.getAttribute('aria-disabled')).toBe('true');
    const supported = places.getByText('Göteborg').closest('[role=option]');
    expect(supported?.getAttribute('aria-disabled')).toBeNull();
  });

  it('keeps a saved place the list does not know, marked as unsupported, instead of dropping it', async () => {
    const onSave = show(demo);
    expect(
      screen.getAllByText('Example municipality (not supported)').length,
    ).toBeGreaterThan(0);
    expect((await save(onSave)).geography.municipalities).toEqual([
      'Example municipality',
    ]);
  });

  it('picks Göteborg and saves it', async () => {
    const onSave = show(demo);
    await choose('Places to search', 'Göteborg');
    expect((await save(onSave)).geography.municipalities).toEqual([
      'Example municipality',
      'Göteborg',
    ]);
  });

  it('names the centre point instead of showing raw coordinates, and can set Brunnsparken', async () => {
    const onSave = show(
      profileWith({
        geography: { ...demo.criteria.geography, center: [12.5, 58.2] },
      }),
    );
    const centre = screen.getByRole('combobox', {
      name: 'Centre of the search circle',
    });
    expect(centre).toHaveProperty('value', 'Current point (58.200, 12.500)');
    expect(screen.queryByLabelText(/longitude|latitude/i)).toBeNull();
    await choose(
      'Centre of the search circle',
      'Brunnsparken, central Göteborg',
    );
    expect((await save(onSave)).geography.center).toEqual([...BRUNNSPARKEN]);
  });

  it('leaves the centre alone when it is already at Brunnsparken', async () => {
    const center: [number, number] = [11.97, 57.71];
    const onSave = show(
      profileWith({ geography: { ...demo.criteria.geography, center } }),
    );
    expect(
      screen.getByRole('combobox', { name: 'Centre of the search circle' }),
    ).toHaveProperty('value', 'Brunnsparken, central Göteborg');
    expect((await save(onSave)).geography.center).toEqual(center);
  });
});

describe('nature and transit preferences', () => {
  it('are not shown, since nothing uses them, and are saved as they were', async () => {
    const onSave = show(demo);
    expect(screen.queryByText(/greenery|walk to|journey/i)).toBeNull();
    const saved = await save(onSave);
    expect(saved.nature).toEqual(demo.criteria.nature);
    expect(saved.transit).toEqual(demo.criteria.transit);
  });
});

describe('who can edit', () => {
  it('disables every dropdown for someone who is not an owner', () => {
    show(demo, false);
    for (const name of [
      'Minimum living area (m²)',
      'Maximum living area (m²)',
      'Minimum rooms',
      'Radius',
      'Centre of the search circle',
      'Places to search',
    ])
      expect(screen.getByRole('combobox', { name })).toHaveProperty(
        'disabled',
        true,
      );
  });
});

describe('How does this work?', () => {
  it('opens a dialog that explains the criteria, and closes with Escape', async () => {
    render(
      <MantineProvider>
        <CriteriaHelp />
      </MantineProvider>,
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'How does this work?' }),
    );
    const dialog = await screen.findByRole('dialog', {
      name: 'How the search works',
    });
    for (const heading of [
      'What gets collected',
      'How a home is sorted',
      'What each setting does',
      'When a fact is unknown',
      'Criteria and filters',
    ])
      expect(
        within(dialog).getByRole('heading', { name: heading }),
      ).toBeTruthy();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

describe('the Settings tab', () => {
  it('offers the explanation next to the criteria', () => {
    render(
      <MantineProvider>
        <SettingsPanel
          snapshot={SYNTHETIC_SNAPSHOT}
          userId={DEMO_USER_ID}
          synthetic
        />
      </MantineProvider>,
    );
    expect(
      screen.getByRole('button', { name: 'How does this work?' }),
    ).toBeTruthy();
  });
});
