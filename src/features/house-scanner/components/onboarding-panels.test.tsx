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
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  HouseholdAccess,
  InvitationPreview,
} from '@/features/house-scanner/api/household-client';
import { HouseholdAccessPanel } from '@/features/house-scanner/components/household-access-panel';
import { InvitePanel } from '@/features/house-scanner/components/invite-panel';
import type { HouseholdAccessActions } from '@/features/house-scanner/types/household';

const TOKEN = 'c'.repeat(64);
const ME = '00000000-0000-4000-8000-0000000000a1';
const OTHER = '00000000-0000-4000-8000-0000000000a2';

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

const view = (node: ReactNode) =>
  render(<MantineProvider>{node}</MantineProvider>);
const type = (label: string | RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe('invitation page', () => {
  function showInvite(preview: InvitationPreview, signedIn: boolean) {
    const actions = {
      onPreview: vi.fn(async () => preview),
      onCreateAccount: vi.fn(async () => {}),
      onAccept: vi.fn(async () => {}),
    };
    view(
      <InvitePanel
        token={TOKEN}
        signedIn={signedIn}
        signIn={<p>Sign-in form</p>}
        {...actions}
      />,
    );
    return actions;
  }
  const create: InvitationPreview = {
    valid: true,
    purpose: 'create',
    expiresAt: '2026-10-28T12:00:00Z',
    householdName: null,
    issuerName: 'Alex',
  };

  it('says when a link cannot be used', async () => {
    showInvite({ valid: false }, false);
    expect(
      await screen.findByText('This invitation cannot be used'),
    ).toBeTruthy();
    expect(screen.queryByText('Sign-in form')).toBeNull();
  });

  it('lets a new person create an account with email and password, beside the sign-in form', async () => {
    const actions = showInvite(create, false);
    expect(await screen.findByText('Create your own household')).toBeTruthy();
    expect(screen.getByText(/It shares nothing with theirs/)).toBeTruthy();
    expect(screen.getByText('Sign-in form')).toBeTruthy();
    type(/Your email/, 'new@example.com');
    type(/Choose a password/, 'a long password');
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() =>
      expect(actions.onCreateAccount).toHaveBeenCalledWith(
        TOKEN,
        'new@example.com',
        'a long password',
      ),
    );
  });

  it('asks a signed-in person for a household name and their own name', async () => {
    const actions = showInvite(create, true);
    await screen.findByText('Create your own household');
    type(/Household name/, 'Our home');
    type(/Your name/, 'Casey');
    fireEvent.click(screen.getByRole('button', { name: 'Create household' }));
    await waitFor(() =>
      expect(actions.onAccept).toHaveBeenCalledWith(TOKEN, 'Our home', 'Casey'),
    );
  });

  it('asks only for a name when joining', async () => {
    const actions = showInvite(
      { ...create, purpose: 'join', householdName: 'Alex home' },
      true,
    );
    expect(await screen.findByText('Join Alex home')).toBeTruthy();
    expect(screen.queryByLabelText(/Household name/)).toBeNull();
    type(/Your name/, 'Casey');
    fireEvent.click(screen.getByRole('button', { name: 'Join household' }));
    await waitFor(() =>
      expect(actions.onAccept).toHaveBeenCalledWith(TOKEN, null, 'Casey'),
    );
  });
});

describe('household settings section', () => {
  function showAccess(data: HouseholdAccess) {
    const access: HouseholdAccessActions = {
      load: vi.fn(async () => structuredClone(data)),
      createLink: vi.fn(async () => `http://localhost/invite?token=${TOKEN}`),
      sendLink: vi.fn(async () => `http://localhost/invite?token=${TOKEN}`),
      revoke: vi.fn(async () => {}),
      rename: vi.fn(async () => {}),
      makeOwner: vi.fn(async () => {}),
      deactivate: vi.fn(async () => {}),
      leave: vi.fn(async () => {}),
    };
    view(<HouseholdAccessPanel access={access} userId={ME} />);
    return access;
  }
  const member = (userId: string, role: 'owner' | 'member', name: string) => ({
    userId,
    displayName: name,
    role,
    active: true,
  });

  it('gives an owner rename, make owner, join links and revoke', async () => {
    vi.stubGlobal('navigator', {
      clipboard: { writeText: vi.fn(async () => {}) },
    });
    const access = showAccess({
      name: 'Home',
      members: [member(ME, 'owner', 'Me'), member(OTHER, 'member', 'Robin')],
      invitations: [
        {
          id: '00000000-0000-4000-8000-0000000000bb',
          email: 'pending@example.com',
          createdAt: '2026-10-20T12:00:00Z',
          expiresAt: '2026-10-27T12:00:00Z',
        },
      ],
    });
    await screen.findByText('Robin');
    type(/Household name/, 'New name');
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    await waitFor(() => expect(access.rename).toHaveBeenCalledWith('New name'));
    fireEvent.click(screen.getByRole('button', { name: 'Make owner' }));
    await waitFor(() => expect(access.makeOwner).toHaveBeenCalledWith(OTHER));
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    await waitFor(() =>
      expect(access.revoke).toHaveBeenCalledWith(
        '00000000-0000-4000-8000-0000000000bb',
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Copy new link' }));
    await waitFor(() =>
      expect(access.createLink).toHaveBeenCalledWith(
        'join',
        'pending@example.com',
      ),
    );
    expect(
      await screen.findByText(/Copied a new link for pending@example.com/),
    ).toBeTruthy();
    expect(access.sendLink).not.toHaveBeenCalled();
  });

  it('checks the address, then sends and copies only after confirmation', async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const access = showAccess({
      name: 'Home',
      members: [member(ME, 'owner', 'Me')],
      invitations: [],
    });
    await screen.findByText('Me (you)');
    type(/Invite someone to join/, 'friend@example');
    fireEvent.click(
      screen.getByRole('button', { name: 'Send join invitation' }),
    );
    expect(
      await screen.findByText('Enter a valid email address.'),
    ).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    type(/Invite someone to join/, 'friend@example.com');
    fireEvent.click(
      screen.getByRole('button', { name: 'Send join invitation' }),
    );
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/friend@example.com/)).toBeTruthy();
    expect(access.sendLink).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(access.sendLink).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole('button', { name: 'Send join invitation' }),
    );
    fireEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: 'Send invitation',
      }),
    );
    await waitFor(() =>
      expect(access.sendLink).toHaveBeenCalledWith(
        'join',
        'friend@example.com',
      ),
    );
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining(TOKEN));
    expect(
      await screen.findByText(/Invitation sent to friend@example.com/),
    ).toBeTruthy();
  });

  it('gives a member a create link and leaving, but no owner controls', async () => {
    const access = showAccess({
      name: 'Home',
      members: [member(OTHER, 'owner', 'Robin'), member(ME, 'member', 'Me')],
      invitations: [],
    });
    await screen.findByText('Robin');
    expect(screen.queryByLabelText(/Household name/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Make owner' })).toBeNull();
    expect(screen.queryByLabelText(/Invite someone to join/)).toBeNull();
    type(/start their own household/, 'new@example.com');
    fireEvent.click(
      screen.getByRole('button', { name: 'Send new household invitation' }),
    );
    fireEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: 'Send invitation',
      }),
    );
    await waitFor(() =>
      expect(access.sendLink).toHaveBeenCalledWith('create', 'new@example.com'),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(
      screen.getByRole('button', { name: 'Leave this household' }),
    );
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText(/An owner can invite you back/),
    ).toBeTruthy();
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Leave household' }),
    );
    await waitFor(() => expect(access.leave).toHaveBeenCalled());
    expect(access.makeOwner).not.toHaveBeenCalled();
  });

  it('asks the last owner to choose a new owner before leaving', async () => {
    const access = showAccess({
      name: 'Home',
      members: [member(ME, 'owner', 'Me'), member(OTHER, 'member', 'Robin')],
      invitations: [],
    });
    await screen.findByText('Robin');
    fireEvent.click(
      screen.getByRole('button', { name: 'Leave this household' }),
    );
    const dialog = await screen.findByRole('dialog');
    const leave = within(dialog).getByRole('button', {
      name: 'Make owner and leave',
    });
    expect(leave.hasAttribute('disabled')).toBe(true);
    fireEvent.click(
      within(dialog).getByRole('combobox', { name: 'New owner' }),
    );
    // The dropdown portals out of the dialog, and jsdom never finishes its open transition.
    fireEvent.click(
      await screen.findByRole('option', { name: 'Robin', hidden: true }),
    );
    await waitFor(() => expect(leave.hasAttribute('disabled')).toBe(false));
    fireEvent.click(leave);
    await waitFor(() => expect(access.leave).toHaveBeenCalled());
    expect(access.makeOwner).toHaveBeenCalledWith(OTHER);
  });

  it('warns the last member that leaving closes the household', async () => {
    showAccess({
      name: 'Home',
      members: [member(ME, 'owner', 'Me')],
      invitations: [],
    });
    await screen.findByText('Me (you)');
    fireEvent.click(
      screen.getByRole('button', { name: 'Leave this household' }),
    );
    expect(
      await screen.findByText(/leaving closes this household/),
    ).toBeTruthy();
  });
});
