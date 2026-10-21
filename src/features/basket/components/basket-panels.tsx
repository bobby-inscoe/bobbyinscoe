import {
  ActionIcon,
  Badge,
  Button,
  Group,
  Menu,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import {
  Check,
  Copy,
  MoreHorizontal,
  Plus,
  Shield,
  UserMinus,
} from 'lucide-react';
import { useState } from 'react';
import { z } from 'zod';
import {
  type BasketClient,
  randomToken,
} from '@/features/basket/api/basket-client';
import type { useBasket } from '@/features/basket/hooks/use-basket';
import { classes } from '@/features/basket/theme/basket-theme';
import {
  type Basket,
  type Kit,
  tokenSchema,
} from '@/features/basket/types/contracts';

type Run = ReturnType<typeof useBasket>['run'];

export function CreateBasket({
  id,
  name,
  busy,
  run,
  onCreated,
  onName,
}: {
  id: string;
  name: string;
  busy: boolean;
  run: Run;
  onCreated: (id: string) => void;
  onName: (name: string) => void;
}) {
  const [title, setTitle] = useState('');
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        const result = await run(
          { type: 'create', id, title, name },
          'Basket created.',
        );
        if (result?.id) onCreated(result.id);
      }}
    >
      <Stack gap="lg">
        <TextInput
          label="Basket name"
          placeholder="Groceries, a weekend away…"
          value={title}
          onChange={(event) => setTitle(event.currentTarget.value)}
          required
          maxLength={80}
          data-autofocus
        />
        <TextInput
          label="Your name"
          description="So everyone knows who is here."
          value={name}
          onChange={(event) => onName(event.currentTarget.value)}
          required
          maxLength={60}
          autoComplete="nickname"
        />
        <Text size="sm" c="dimmed">
          You’ll be the owner. Invite people with a link whenever you’re ready.
        </Text>
        <Button type="submit" loading={busy}>
          Create basket
        </Button>
      </Stack>
    </form>
  );
}

export function TextEditor({
  label,
  initial,
  maxLength,
  busy,
  onSave,
  help,
}: {
  label: string;
  initial: string;
  maxLength: number;
  busy: boolean;
  onSave: (value: string) => Promise<void>;
  help?: string;
}) {
  const [value, setValue] = useState(initial);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void onSave(value.trim());
      }}
    >
      <Stack gap="lg">
        <TextInput
          label={label}
          value={value}
          onChange={(event) => setValue(event.currentTarget.value)}
          required
          maxLength={maxLength}
          data-autofocus
        />
        {help && (
          <Text size="sm" c="dimmed">
            {help}
          </Text>
        )}
        <Button type="submit" loading={busy}>
          Save changes
        </Button>
      </Stack>
    </form>
  );
}

const cachedLink = z.strictObject({ id: z.uuid(), token: tokenSchema });
function readLink(basket: Basket) {
  try {
    const value = cachedLink.safeParse(
      JSON.parse(localStorage.getItem(`basket.link.${basket.id}`) ?? 'null'),
    );
    return value.success && value.data.id === basket.linkId ? value.data : null;
  } catch {
    return null;
  }
}
export function ShareBasket({
  basket,
  busy,
  run,
  onStatus,
  onError,
}: {
  basket: Basket;
  busy: boolean;
  run: Run;
  onStatus: (text: string) => void;
  onError: (text: string) => void;
}) {
  const [link, setLink] = useState(() => readLink(basket));
  const current = link?.id === basket.linkId ? link : null;
  const url = current
    ? `${window.location.origin}/basket#join=${current.token}`
    : '';
  async function create() {
    const next = { id: crypto.randomUUID(), token: randomToken() };
    const result = await run(
      { type: 'link_set', basketId: basket.id, ...next },
      'A new join link is ready.',
    );
    if (!result) return;
    setLink(next);
    try {
      localStorage.setItem(`basket.link.${basket.id}`, JSON.stringify(next));
    } catch {
      onStatus('Copy the link now; this browser cannot remember it.');
    }
  }
  return (
    <Stack gap="lg">
      <Text>
        Anyone with this link can join as a member. Your owner access stays
        private.
      </Text>
      {url ? (
        <>
          <TextInput
            label="Join link"
            value={url}
            readOnly
            onFocus={(event) => event.currentTarget.select()}
          />
          <Button
            leftSection={<Copy size={18} />}
            onClick={async () => {
              try {
                if (navigator.share)
                  await navigator.share({ title: basket.title, url });
                else {
                  await navigator.clipboard.writeText(url);
                  onStatus('Join link copied.');
                }
              } catch (cause) {
                if (
                  !(
                    cause instanceof DOMException && cause.name === 'AbortError'
                  )
                )
                  onError(
                    'Could not share the link. Select and copy it from the field above.',
                  );
              }
            }}
          >
            Share link
          </Button>
          <Text size="sm" c="dimmed">
            Disable or replace this link in Basket settings.
          </Text>
        </>
      ) : (
        <>
          {basket.linkId && (
            <Text size="sm" c="dimmed">
              An existing link is active, but its copy is not saved in this
              browser. Creating a replacement stops that old link from accepting
              new people. Existing members keep access.
            </Text>
          )}
          <Button
            onClick={() => {
              void create();
            }}
            loading={busy}
          >
            {basket.linkId
              ? 'Replace existing join link'
              : 'Create a join link'}
          </Button>
        </>
      )}
    </Stack>
  );
}

export function People({
  basket,
  userId,
  busy,
  run,
}: {
  basket: Basket;
  userId: string;
  busy: boolean;
  run: Run;
}) {
  return (
    <Stack gap="sm">
      <Text size="sm" c="dimmed">
        Owners can reset, archive, invite people, and change roles.
      </Text>
      {basket.members.map((member) => (
        <Group
          className={classes.person}
          key={member.id}
          justify="space-between"
          wrap="nowrap"
        >
          <div className={classes.grow}>
            <Text fw={600} style={{ overflowWrap: 'anywhere' }}>
              {member.name}
              {member.id === userId ? ' (you)' : ''}
            </Text>
            <Badge variant="light" mt={4}>
              {member.role}
            </Badge>
          </div>
          {basket.role === 'owner' &&
            member.id !== userId &&
            !basket.archived && (
              <Menu position="bottom-end" withinPortal>
                <Menu.Target>
                  <ActionIcon
                    variant="subtle"
                    aria-label={`Actions for ${member.name}`}
                    disabled={busy}
                  >
                    <MoreHorizontal size={20} />
                  </ActionIcon>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Item
                    leftSection={<Shield size={16} />}
                    onClick={() => {
                      void run(
                        {
                          type: 'person',
                          basketId: basket.id,
                          id: member.id,
                          role: member.role === 'owner' ? 'member' : 'owner',
                          revision: basket.revision,
                        },
                        'Role updated.',
                      );
                    }}
                  >
                    {member.role === 'owner' ? 'Make member' : 'Make owner'}
                  </Menu.Item>
                  <Menu.Item
                    color="red"
                    leftSection={<UserMinus size={16} />}
                    onClick={() => {
                      void run(
                        {
                          type: 'person',
                          basketId: basket.id,
                          id: member.id,
                          role: 'removed',
                          revision: basket.revision,
                        },
                        'Person removed.',
                      );
                    }}
                  >
                    Remove from basket
                  </Menu.Item>
                </Menu.Dropdown>
              </Menu>
            )}
        </Group>
      ))}
    </Stack>
  );
}

export function SavedKits({
  basket,
  kits,
  busy,
  run,
  onEdit,
  onCreate,
}: {
  basket: Basket;
  kits: Kit[];
  busy: boolean;
  run: Run;
  onEdit: (id: string) => void;
  onCreate: () => void;
}) {
  const owner = basket.role === 'owner' && !basket.archived;
  return (
    <Stack gap="lg">
      <Text size="sm" c="dimmed">
        Reset starts again from these saved copies. Editing your personal kits
        won’t change them.
      </Text>
      {basket.savedKits.length === 0 && (
        <Text>No starting kits saved yet.</Text>
      )}
      {basket.savedKits.map((kit) => (
        <Stack className={classes.saved} gap="sm" key={kit.id}>
          <Text fw={600}>{kit.title}</Text>
          <Text size="sm" style={{ overflowWrap: 'anywhere' }}>
            {kit.items.map((item) => item.text).join(' · ')}
          </Text>
          {owner && (
            <Group>
              <Button
                size="sm"
                variant="light"
                onClick={() => onEdit(kit.id)}
                disabled={busy}
              >
                Edit starting items
              </Button>
              <Button
                size="sm"
                variant="subtle"
                color="red"
                disabled={busy}
                onClick={() => {
                  void run(
                    {
                      type: 'saved_remove',
                      basketId: basket.id,
                      id: kit.id,
                      revision: basket.revision,
                    },
                    'Removed from future resets. Current checklist items are unchanged.',
                  );
                }}
              >
                Remove saved kit
              </Button>
            </Group>
          )}
        </Stack>
      ))}
      {owner && (
        <>
          <Text fw={600}>Add from your kits</Text>
          {kits.map((kit) => (
            <Group key={kit.id} justify="space-between" wrap="nowrap">
              <div className={classes.grow}>
                <Text fw={500}>{kit.title}</Text>
                <Text size="sm" c="dimmed">
                  {kit.items.length} starting items
                </Text>
              </div>
              <Button
                variant="light"
                disabled={busy}
                leftSection={<Plus size={16} />}
                onClick={() => {
                  void run(
                    {
                      type: 'kit_attach',
                      basketId: basket.id,
                      id: crypto.randomUUID(),
                      kitId: kit.id,
                    },
                    'Kit saved and its items added.',
                  );
                }}
              >
                Add kit
              </Button>
            </Group>
          ))}
          <Button
            variant="subtle"
            leftSection={<Plus size={16} />}
            onClick={onCreate}
            disabled={busy}
          >
            Create a personal kit
          </Button>
        </>
      )}
    </Stack>
  );
}

export function AccountAccess({
  client,
  guest,
  email: signedInEmail,
  onChanged,
  onError,
  onClose,
}: {
  client: BasketClient;
  guest: boolean;
  email?: string;
  onChanged: () => Promise<void>;
  onError: (text: string) => void;
  onClose: () => void;
}) {
  const [email, setEmail] = useState(''),
    [code, setCode] = useState(''),
    [existing, setExisting] = useState(false),
    [sent, setSent] = useState(false),
    [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    onError('');
    try {
      if (sent) {
        await client.verifyAccountCode(code);
        await onChanged();
        onClose();
      } else {
        await client.sendAccountCode(email, existing);
        setSent(true);
      }
    } catch (cause) {
      onError(
        cause instanceof Error
          ? cause.message
          : 'Could not finish account setup. Your guest access is unchanged.',
      );
    } finally {
      setBusy(false);
    }
  }
  if (!guest)
    return (
      <Stack gap="lg">
        <Text>
          Signed in as {signedInEmail}. Your baskets and kits are available on
          your other devices.
        </Text>
        <Button
          variant="light"
          onClick={async () => {
            setBusy(true);
            try {
              await client.signOut();
              onClose();
            } catch {
              onError('Could not sign out. Please try again.');
            } finally {
              setBusy(false);
            }
          }}
          loading={busy}
        >
          Sign out of this browser
        </Button>
      </Stack>
    );
  if (import.meta.env.VITE_BASKET_EMAIL_ENABLED !== 'true')
    return (
      <Text>
        Email access is not available yet. Your baskets and kits stay available
        in this browser. Keep using this browser to retain your guest access.
      </Text>
    );
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <Stack gap="lg">
        <Text>
          Your guest baskets and kits are saved. Connect an email to keep access
          on another device.
        </Text>
        {!sent ? (
          <>
            <TextInput
              label="Email address"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.currentTarget.value)}
              data-autofocus
            />
            <Button type="submit" loading={busy}>
              {existing ? 'Send sign-in code' : 'Send verification code'}
            </Button>
            <Button
              variant="subtle"
              disabled={busy}
              onClick={() => {
                setExisting(!existing);
                onError('');
              }}
            >
              {existing
                ? 'Create a new account instead'
                : 'Sign in to an existing account'}
            </Button>
          </>
        ) : (
          <>
            <Text size="sm">
              Enter the code emailed to {email}. You can keep using this browser
              as a guest if you close this panel.
            </Text>
            <TextInput
              label="Email code"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(event) => setCode(event.currentTarget.value)}
              required
              pattern="[0-9]{6,10}"
              minLength={6}
              maxLength={10}
              data-autofocus
            />
            <Button
              type="submit"
              loading={busy}
              leftSection={<Check size={18} />}
            >
              Verify and keep my access
            </Button>
            <Button
              variant="subtle"
              disabled={busy}
              onClick={() => {
                setSent(false);
                setCode('');
              }}
            >
              Request a fresh code
            </Button>
          </>
        )}
      </Stack>
    </form>
  );
}
