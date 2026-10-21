import {
  ActionIcon,
  Alert,
  Anchor,
  Button,
  Checkbox,
  Divider,
  Drawer,
  Group,
  Loader,
  MantineThemeProvider,
  Menu,
  Stack,
  Text,
  TextInput,
  Title,
  UnstyledButton,
} from '@mantine/core';
import {
  Link,
  useLocation,
  useNavigate,
  useSearch,
} from '@tanstack/react-router';
import {
  Archive,
  ArrowLeft,
  ArrowRight,
  ChevronRight,
  Layers,
  ListChecks,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  Settings,
  Share2,
  ShoppingBasket,
  Trash2,
  UserRound,
  Users,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { getBasketClient } from '@/features/basket/api/basket-client';
import {
  AccountAccess,
  CreateBasket,
  People,
  SavedKits,
  ShareBasket,
  TextEditor,
} from '@/features/basket/components/basket-panels';
import { KitEditor } from '@/features/basket/components/kit-editor';
import { useBasket } from '@/features/basket/hooks/use-basket';
import { basketTheme, classes } from '@/features/basket/theme/basket-theme';
import {
  type Basket,
  changedKitItems,
  type Item,
  type Kit,
  nameSchema,
  type SavedKit,
  searchSchema,
  tokenSchema,
} from '@/features/basket/types/contracts';

type Sheet =
  | { type: 'create'; id: string }
  | { type: 'kit'; id: string; kit?: Kit; returnToSaved?: boolean }
  | { type: 'deleteKit'; kit: Kit }
  | { type: 'saved'; kit: SavedKit; revision: number }
  | { type: 'item'; item: Item }
  | { type: 'reset' | 'archive' | 'rename'; basket: Basket }
  | { type: 'people' | 'savedKits' | 'settings' | 'share' | 'account' };
const sheetNames: Record<Sheet['type'], string> = {
  create: 'A new basket',
  kit: 'Your personal kit',
  deleteKit: 'Delete personal kit?',
  saved: 'Edit starting kit',
  item: 'Edit this item',
  reset: 'Reset to saved kits?',
  archive: 'Archive for everyone?',
  rename: 'Rename basket',
  people: 'People',
  savedKits: 'Saved kits',
  settings: 'Basket settings',
  share: 'Invite with a link',
  account: 'Your access',
};

export function BasketPage() {
  const search = searchSchema.parse(useSearch({ strict: false }));
  const hash = useLocation({ select: (location) => location.hash });
  const invitation = tokenSchema.safeParse(
    new URLSearchParams(hash).get('join'),
  );
  const joinToken = invitation.success ? invitation.data : null;
  const navigate = useNavigate({ from: '/basket' });
  const [client] = useState(getBasketClient);
  const state = useBasket(client, search.basket);
  const [view, setView] = useState<'baskets' | 'kits'>('baskets');
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [name, setName] = useState('');
  const [newItem, setNewItem] = useState('');
  const [newItemId, setNewItemId] = useState(() => crypto.randomUUID());
  const [showArchived, setShowArchived] = useState(false);
  const [pendingChecks, setPendingChecks] = useState<
    Record<string, { completed: boolean; request: string }>
  >({});
  const addingItem = useRef(false);
  const resetting = useRef(false);
  const previousIdentity = useRef<string | null>(null);
  useEffect(() => {
    const next = state.user?.id ?? null;
    if (
      (previousIdentity.current && previousIdentity.current !== next) ||
      state.unavailable
    ) {
      setSheet(null);
      setNewItem('');
      setName('');
      setNewItemId(crypto.randomUUID());
      setPendingChecks({});
    }
    previousIdentity.current = next;
  }, [state.user?.id, state.unavailable]);
  function rememberName(value: string) {
    setName(value);
    const parsed = nameSchema.safeParse(value);
    if (!state.user || !parsed.success) return;
    try {
      localStorage.setItem(`basket.name.${state.user.id}`, parsed.data);
    } catch {
      // The current page still remembers the name when browser storage is unavailable.
    }
  }
  useEffect(() => {
    const data = state.data;
    if (!client || !data || data.userId !== state.user?.id) return;
    const currentData = data;
    const currentClient = client;
    let active = true;
    const key = `basket.name.${currentData.userId}`;
    async function restoreName() {
      try {
        const stored = nameSchema.safeParse(localStorage.getItem(key));
        if (stored.success) {
          if (active) setName((current) => current || stored.data);
          return;
        }
      } catch {
        // Membership names also provide a default when storage is unavailable.
      }
      try {
        const known =
          currentData.basket ??
          (currentData.baskets[0]
            ? (await currentClient.snapshot(currentData.baskets[0].id)).basket
            : null);
        const member = known?.members.find(
          (person) => person.id === currentData.userId,
        );
        if (!active || !member) return;
        setName((current) => current || member.name);
        try {
          if (!nameSchema.safeParse(localStorage.getItem(key)).success)
            localStorage.setItem(key, member.name);
        } catch {
          /* Storage is optional. */
        }
      } catch {
        // A failed lookup leaves the name editable.
      }
    }
    void restoreName();
    return () => {
      active = false;
    };
  }, [client, state.data, state.user?.id]);
  const basket = state.data?.basket ?? null;
  const owner = basket?.role === 'owner';
  const writable = !!basket && !basket.archived;
  const close = () => {
    setSheet(null);
    state.setError('');
  };
  function open(next: Sheet) {
    state.setError('');
    state.setStatus('');
    setSheet(next);
  }
  function go(id?: string) {
    close();
    setView('baskets');
    setNewItem('');
    setNewItemId(crypto.randomUUID());
    void navigate({ search: id ? { basket: id } : {}, hash: '' });
  }
  const availableBaskets =
    state.data?.baskets.filter((entry) => entry.archived === showArchived) ??
    [];
  const completed = basket?.items.filter((item) => item.completed).length ?? 0;
  const changed = basket ? changedKitItems(basket) : 0;
  const personalKits = state.data?.kits ?? [];
  const error = state.error && (
    <Alert color="red" role="alert" title="Could not finish">
      {state.error}
    </Alert>
  );

  async function reset(current: Basket) {
    if (resetting.current) return;
    resetting.current = true;
    try {
      if (
        await state.run(
          { type: 'reset', basketId: current.id, revision: current.revision },
          'Basket reset to saved kits.',
        )
      )
        setSheet((openSheet) =>
          openSheet?.type === 'reset' && openSheet.basket.id === current.id
            ? null
            : openSheet,
        );
    } finally {
      resetting.current = false;
    }
  }
  function requestReset(current: Basket) {
    if (current.members.length > 1 || changedKitItems(current) > 0)
      open({ type: 'reset', basket: current });
    else void reset(current);
  }

  async function archive(current: Basket) {
    const result = await state.run(
      {
        type: 'archive',
        basketId: current.id,
        revision: current.revision,
        archived: !current.archived,
      },
      current.archived ? 'Basket restored.' : 'Basket archived.',
    );
    if (result) close();
  }

  return (
    <MantineThemeProvider theme={basketTheme}>
      <div className={`${classes.scope} ${classes.page}`}>
        <div className={classes.frame}>
          <header className={classes.header}>
            <Link
              to="/basket"
              search={{}}
              hash=""
              className={classes.brand}
              aria-label="Basket home"
            >
              <ShoppingBasket size={28} strokeWidth={1.6} aria-hidden="true" />
              basket
            </Link>
            <ActionIcon
              variant="subtle"
              aria-label="Your access"
              onClick={() => open({ type: 'account' })}
              disabled={!client}
            >
              <UserRound size={22} />
            </ActionIcon>
          </header>
          <main className={classes.main}>
            {!sheet && error}
            {!client ? (
              <Stack gap="lg" className={classes.intro}>
                <Text className={classes.eyebrow}>Lists for life together</Text>
                <Title className={classes.headline}>
                  A place for everything on your list.
                </Title>
                <Text>
                  Groceries, packing, and plans with friends. Basket is being
                  set up at this address.
                </Text>
                <Text c="dimmed" size="sm">
                  Shared lists will be available here once setup is complete.
                </Text>
                <Anchor component={Link} to="/">
                  Back to projects
                </Anchor>
              </Stack>
            ) : joinToken ? (
              <Stack gap="lg" className={classes.intro}>
                <div className={classes.cardIcon}>
                  <Users aria-hidden="true" />
                </div>
                <Text className={classes.eyebrow}>A list to share</Text>
                <Title className={classes.headline}>You’re invited.</Title>
                <Text>
                  Choose what everyone should call you, then jump into the
                  basket. No account needed.
                </Text>
                <form
                  onSubmit={async (event) => {
                    event.preventDefault();
                    const result = await state.run(
                      { type: 'join', token: joinToken, name },
                      'You joined the basket.',
                    );
                    if (result?.id) go(result.id);
                  }}
                >
                  <Stack gap="md">
                    <TextInput
                      label="Your name"
                      autoComplete="nickname"
                      value={name}
                      onChange={(event) =>
                        rememberName(event.currentTarget.value)
                      }
                      required
                      maxLength={60}
                    />
                    <Button
                      type="submit"
                      loading={state.busy}
                      rightSection={<ArrowRight size={18} />}
                    >
                      Join basket
                    </Button>
                  </Stack>
                </form>
                <Link to="/basket" search={{}} hash="">
                  Go to your baskets
                </Link>
              </Stack>
            ) : state.unavailable ? (
              <Stack gap="lg">
                <Title order={1}>Basket unavailable</Title>
                <Text>
                  You may have left this basket, or an owner may have removed
                  your access.
                </Text>
                <Button onClick={() => go()}>Back to your baskets</Button>
              </Stack>
            ) : state.loading && !state.data ? (
              <Group role="status">
                <Loader size="sm" />
                <Text>Opening your baskets…</Text>
              </Group>
            ) : search.basket && !basket ? (
              <Stack gap="lg">
                <Title order={1}>Open your basket</Title>
                <Text>
                  This browser needs a current guest session or your account to
                  open a private basket.
                </Text>
                <Button onClick={() => open({ type: 'account' })}>
                  Sign in to your account
                </Button>
                <Button variant="light" onClick={() => go()}>
                  Back to baskets
                </Button>
              </Stack>
            ) : basket ? (
              <>
                <Button
                  variant="subtle"
                  px={0}
                  mb="lg"
                  leftSection={<ArrowLeft size={17} />}
                  onClick={() => go()}
                >
                  Your baskets
                </Button>
                <Group justify="space-between" align="flex-start" wrap="nowrap">
                  <div className={classes.grow}>
                    <Text className={classes.eyebrow}>
                      {basket.archived ? 'Archived basket' : 'Your shared list'}
                    </Text>
                    <Title className={classes.headline} mt={8}>
                      {basket.title}
                    </Title>
                  </div>
                  <Menu position="bottom-end" withinPortal>
                    <Menu.Target>
                      <ActionIcon variant="subtle" aria-label="Basket actions">
                        <MoreHorizontal size={24} />
                      </ActionIcon>
                    </Menu.Target>
                    <Menu.Dropdown>
                      <Menu.Item
                        leftSection={<Users size={17} />}
                        onClick={() => open({ type: 'people' })}
                      >
                        People
                      </Menu.Item>
                      <Menu.Item
                        leftSection={<Layers size={17} />}
                        onClick={() => open({ type: 'savedKits' })}
                      >
                        Saved kits
                      </Menu.Item>
                      <Menu.Item
                        leftSection={<Settings size={17} />}
                        onClick={() => open({ type: 'settings' })}
                      >
                        Basket settings
                      </Menu.Item>
                      {owner && (
                        <>
                          <Menu.Divider />
                          <Menu.Item
                            disabled={!writable}
                            leftSection={<Pencil size={17} />}
                            onClick={() => open({ type: 'rename', basket })}
                          >
                            Rename basket
                          </Menu.Item>
                          <Menu.Item
                            leftSection={<Archive size={17} />}
                            onClick={() => {
                              if (
                                basket.archived ||
                                basket.members.length === 1
                              )
                                void archive(basket);
                              else open({ type: 'archive', basket });
                            }}
                          >
                            {basket.archived
                              ? 'Restore basket'
                              : 'Archive basket'}
                          </Menu.Item>
                        </>
                      )}
                    </Menu.Dropdown>
                  </Menu>
                </Group>
                <Group justify="space-between" mt="md" gap="xs">
                  <Button
                    variant="subtle"
                    size="sm"
                    px={0}
                    leftSection={<Users size={16} />}
                    onClick={() => open({ type: 'people' })}
                  >
                    {basket.members.length === 1
                      ? 'Just you, for now'
                      : `${basket.members.length} people`}
                  </Button>
                  {owner && writable && (
                    <Button
                      variant="light"
                      size="sm"
                      leftSection={<Share2 size={16} />}
                      onClick={() => open({ type: 'share' })}
                    >
                      Share basket
                    </Button>
                  )}
                </Group>
                {basket.archived && (
                  <Alert mt="md" title="Taking a break">
                    This basket is archived.{' '}
                    {owner
                      ? 'Restore it from Basket actions to use it again.'
                      : 'An owner can restore it.'}
                  </Alert>
                )}
                <Group justify="space-between" mt="lg">
                  <Text size="sm" c="dimmed">
                    {completed} of {basket.items.length} done
                  </Text>
                  {basket.savedKits.length > 0 && (
                    <Button
                      variant="subtle"
                      size="sm"
                      px={0}
                      onClick={() => open({ type: 'savedKits' })}
                    >
                      {basket.savedKits.length} saved{' '}
                      {basket.savedKits.length === 1 ? 'kit' : 'kits'}
                    </Button>
                  )}
                </Group>
                {owner && writable && (
                  <Button
                    mt="sm"
                    variant="light"
                    leftSection={<RotateCcw size={16} />}
                    disabled={!basket.savedKits.length}
                    onClick={() => requestReset(basket)}
                  >
                    Reset basket
                  </Button>
                )}
                {basket.items.length ? (
                  <ul className={classes.list} aria-label="Checklist items">
                    {basket.items.map((item) => (
                      <li className={classes.row} key={item.id}>
                        <Checkbox.Card
                          className={classes.check}
                          withBorder={false}
                          aria-label={item.text}
                          checked={
                            pendingChecks[item.id]?.completed ?? item.completed
                          }
                          disabled={!writable}
                          onChange={(desired) => {
                            const request = crypto.randomUUID();
                            setPendingChecks((current) => ({
                              ...current,
                              [item.id]: { completed: desired, request },
                            }));
                            void state
                              .run(
                                {
                                  type: 'item_check',
                                  basketId: basket.id,
                                  id: item.id,
                                  completed: desired,
                                },
                                desired
                                  ? `${item.text} checked.`
                                  : `${item.text} unchecked.`,
                              )
                              .finally(() =>
                                setPendingChecks((current) => {
                                  if (current[item.id]?.request !== request)
                                    return current;
                                  const next = { ...current };
                                  delete next[item.id];
                                  return next;
                                }),
                              );
                          }}
                        >
                          <Checkbox.Indicator size="md" aria-hidden="true" />
                          <span
                            className={`${classes.itemLabel} ${(pendingChecks[item.id]?.completed ?? item.completed) ? classes.completed : ''}`}
                          >
                            {item.text}
                          </span>
                        </Checkbox.Card>
                        {writable && (
                          <Menu position="bottom-end" withinPortal>
                            <Menu.Target>
                              <ActionIcon
                                variant="subtle"
                                aria-label={`Actions for ${item.text}`}
                              >
                                <MoreHorizontal size={20} />
                              </ActionIcon>
                            </Menu.Target>
                            <Menu.Dropdown>
                              <Menu.Item
                                leftSection={<Pencil size={16} />}
                                onClick={() => open({ type: 'item', item })}
                              >
                                Rename item
                              </Menu.Item>
                              <Menu.Item
                                color="red"
                                leftSection={<Trash2 size={16} />}
                                onClick={() => {
                                  void state.run(
                                    {
                                      type: 'item_remove',
                                      basketId: basket.id,
                                      id: item.id,
                                      revision: item.revision,
                                    },
                                    'Item removed.',
                                  );
                                }}
                              >
                                Remove item
                              </Menu.Item>
                            </Menu.Dropdown>
                          </Menu>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Stack className={classes.empty} mt="lg" gap="sm">
                    <ShoppingBasket
                      size={32}
                      aria-hidden="true"
                      style={{ alignSelf: 'center' }}
                    />
                    <Text fw={600}>A little room for what’s next.</Text>
                    <Text size="sm" c="dimmed">
                      Add an item below
                      {owner ? ', or start with a saved kit.' : '.'}
                    </Text>
                    {owner && writable && (
                      <Button
                        variant="subtle"
                        onClick={() => open({ type: 'savedKits' })}
                      >
                        Choose starting kits
                      </Button>
                    )}
                  </Stack>
                )}
                {changed > 0 && (
                  <Text size="sm" c="dimmed" mb="md">
                    {changed} {changed === 1 ? 'item differs' : 'items differ'}{' '}
                    from saved kits. Reset restores the starting names.
                  </Text>
                )}
                {writable && (
                  <form
                    className={classes.composer}
                    onSubmit={async (event) => {
                      event.preventDefault();
                      if (addingItem.current) return;
                      addingItem.current = true;
                      const submitted = newItem;
                      try {
                        const result = await state.run(
                          {
                            type: 'item_add',
                            basketId: basket.id,
                            id: newItemId,
                            text: newItem,
                          },
                          'Item added.',
                        );
                        if (result) {
                          setNewItem((current) =>
                            current === submitted ? '' : current,
                          );
                          setNewItemId(crypto.randomUUID());
                        }
                      } finally {
                        addingItem.current = false;
                      }
                    }}
                  >
                    <Group gap="sm" align="end" wrap="nowrap">
                      <TextInput
                        className={classes.grow}
                        label="Add an item"
                        placeholder="What else do you need?"
                        value={newItem}
                        onChange={(event) =>
                          setNewItem(event.currentTarget.value)
                        }
                        required
                        maxLength={240}
                        autoComplete="off"
                      />
                      <ActionIcon
                        type="submit"
                        variant="filled"
                        size={48}
                        aria-label="Add item"
                      >
                        <Plus size={22} />
                      </ActionIcon>
                    </Group>
                  </form>
                )}
                <Text size="xs" c="dimmed" mt="xs">
                  {state.connected
                    ? 'Connected to this basket'
                    : 'Checking for updates periodically'}
                </Text>
              </>
            ) : view === 'kits' ? (
              <Stack gap="lg">
                <Group justify="space-between" wrap="nowrap">
                  <div>
                    <Text className={classes.eyebrow}>
                      Keep the usuals handy
                    </Text>
                    <Title className={classes.headline} mt={8}>
                      Your kits
                    </Title>
                  </div>
                  <ActionIcon
                    aria-label="Create a kit"
                    variant="filled"
                    onClick={() =>
                      open({ type: 'kit', id: crypto.randomUUID() })
                    }
                  >
                    <Plus size={22} />
                  </ActionIcon>
                </Group>
                <Text c="dimmed">
                  Save the things you use again. Add a kit to any basket you
                  own.
                </Text>
                {personalKits.length ? (
                  personalKits.map((kit) => (
                    <UnstyledButton
                      className={classes.card}
                      key={kit.id}
                      onClick={() => open({ type: 'kit', id: kit.id, kit })}
                    >
                      <span className={classes.cardIcon}>
                        <Layers size={22} aria-hidden="true" />
                      </span>
                      <span className={classes.cardCopy}>
                        <span className={classes.cardName}>{kit.title}</span>
                        <span className={classes.cardMeta}>
                          {kit.items.length} starting items
                        </span>
                      </span>
                      <ChevronRight size={20} aria-hidden="true" />
                    </UnstyledButton>
                  ))
                ) : (
                  <Stack className={classes.empty} gap="md">
                    <Layers
                      size={30}
                      style={{ alignSelf: 'center' }}
                      aria-hidden="true"
                    />
                    <Text fw={600}>Your next list starts here.</Text>
                    <Text size="sm" c="dimmed">
                      Grocery staples. Packing essentials. Save a group once and
                      use it again.
                    </Text>
                    <Button
                      leftSection={<Plus size={17} />}
                      onClick={() =>
                        open({ type: 'kit', id: crypto.randomUUID() })
                      }
                    >
                      Create your first kit
                    </Button>
                  </Stack>
                )}
              </Stack>
            ) : (
              <Stack gap="lg">
                <div>
                  <Text className={classes.eyebrow}>A little shared space</Text>
                  <Title className={classes.headline} mt={8}>
                    {state.data?.baskets.length
                      ? 'Your baskets'
                      : 'What’s on the list?'}
                  </Title>
                </div>
                {!state.data?.baskets.length && (
                  <Text c="dimmed">
                    Groceries, a weekend away, a plan with friends. Start a
                    basket and share the link.
                  </Text>
                )}
                <Button
                  leftSection={<Plus size={19} />}
                  onClick={() =>
                    open({ type: 'create', id: crypto.randomUUID() })
                  }
                >
                  Create a basket
                </Button>
                {!!state.data?.baskets.length && (
                  <Group justify="space-between">
                    <Text size="sm" c="dimmed">
                      {showArchived ? 'Archived' : 'Ready to use'}
                    </Text>
                    <Button
                      variant="subtle"
                      size="sm"
                      onClick={() => setShowArchived(!showArchived)}
                    >
                      {showArchived ? 'Show active' : 'Show archived'}
                    </Button>
                  </Group>
                )}
                {availableBaskets.map((entry) => (
                  <UnstyledButton
                    className={classes.card}
                    key={entry.id}
                    onClick={() => go(entry.id)}
                  >
                    <span className={classes.cardIcon}>
                      {entry.archived ? (
                        <Archive size={22} aria-hidden="true" />
                      ) : (
                        <ShoppingBasket size={22} aria-hidden="true" />
                      )}
                    </span>
                    <span className={classes.cardCopy}>
                      <span className={classes.cardName}>{entry.title}</span>
                      <span className={classes.cardMeta}>
                        {entry.peopleCount === 1
                          ? 'Just you'
                          : `${entry.peopleCount} people`}{' '}
                        ·{' '}
                        {entry.role === 'owner'
                          ? 'You’re an owner'
                          : 'Shared with you'}
                      </span>
                    </span>
                    <ChevronRight size={20} aria-hidden="true" />
                  </UnstyledButton>
                ))}
                {showArchived && !availableBaskets.length && (
                  <Text c="dimmed">No archived baskets.</Text>
                )}
                {!state.user || state.user.is_anonymous ? (
                  <Stack gap="xs" mt="md">
                    <Text size="sm" c="dimmed">
                      This browser remembers you. An optional account keeps
                      access across devices.
                    </Text>
                    <Button
                      variant="subtle"
                      onClick={() => open({ type: 'account' })}
                    >
                      Keep my access
                    </Button>
                  </Stack>
                ) : null}
              </Stack>
            )}
            {!sheet && (
              <div role="status" aria-live="polite" className={classes.status}>
                {state.status}
              </div>
            )}
            {!!state.error && !sheet && (
              <Button
                variant="subtle"
                onClick={() => {
                  state.setError('');
                  void state.reload();
                }}
              >
                Refresh
              </Button>
            )}
          </main>
        </div>
        {client && (
          <nav className={classes.bottom} aria-label="Basket navigation">
            <div className={classes.bottomInner}>
              <UnstyledButton
                className={classes.bottomButton}
                aria-pressed={view === 'baskets'}
                onClick={() => go()}
              >
                <ListChecks size={22} aria-hidden="true" />
                Baskets
              </UnstyledButton>
              <UnstyledButton
                className={classes.bottomButton}
                aria-pressed={view === 'kits'}
                onClick={() => {
                  close();
                  setView('kits');
                  void navigate({ search: {}, hash: '' });
                }}
              >
                <Layers size={22} aria-hidden="true" />
                Kits
              </UnstyledButton>
            </div>
          </nav>
        )}
        <Drawer
          opened={!!sheet}
          onClose={close}
          title={sheet ? sheetNames[sheet.type] : ''}
        >
          {error}
          {sheet?.type === 'create' && (
            <CreateBasket
              id={sheet.id}
              name={name}
              onName={rememberName}
              busy={state.busy}
              run={state.run}
              onCreated={go}
            />
          )}
          {sheet?.type === 'kit' && (
            <KitEditor
              key={sheet.id}
              kit={sheet.kit}
              busy={state.busy}
              onSave={async (title, items) => {
                const result = await state.run(
                  {
                    type: 'kit_save',
                    id: sheet.id,
                    revision: sheet.kit?.revision,
                    title,
                    items,
                  },
                  'Personal kit saved.',
                );
                if (result) {
                  if (sheet.returnToSaved) setSheet({ type: 'savedKits' });
                  else close();
                }
              }}
              onDelete={
                sheet.kit
                  ? () => setSheet({ type: 'deleteKit', kit: sheet.kit as Kit })
                  : undefined
              }
            />
          )}
          {sheet?.type === 'deleteKit' && (
            <Stack gap="lg">
              <Text>
                Delete “{sheet.kit.title}” from your personal kits? Copies
                already saved to baskets will stay.
              </Text>
              <Button
                color="red"
                loading={state.busy}
                onClick={async () => {
                  if (
                    await state.run(
                      {
                        type: 'kit_delete',
                        id: sheet.kit.id,
                        revision: sheet.kit.revision,
                      },
                      'Personal kit deleted.',
                    )
                  )
                    close();
                }}
              >
                Delete kit
              </Button>
              <Button variant="light" onClick={close}>
                Keep kit
              </Button>
            </Stack>
          )}
          {sheet?.type === 'item' && basket && (
            <TextEditor
              label="Item name"
              initial={sheet.item.text}
              maxLength={240}
              busy={state.busy}
              help={
                sheet.item.sourceId
                  ? 'This change is for this round. Reset will restore its name from the saved kit.'
                  : undefined
              }
              onSave={async (text) => {
                if (
                  await state.run(
                    {
                      type: 'item_edit',
                      basketId: basket.id,
                      id: sheet.item.id,
                      text,
                      revision: sheet.item.revision,
                    },
                    'Item renamed.',
                  )
                )
                  close();
              }}
            />
          )}
          {sheet?.type === 'rename' && (
            <TextEditor
              label="Basket name"
              initial={sheet.basket.title}
              maxLength={80}
              busy={state.busy}
              onSave={async (title) => {
                if (
                  await state.run(
                    {
                      type: 'rename',
                      basketId: sheet.basket.id,
                      title,
                      revision: sheet.basket.revision,
                    },
                    'Basket renamed.',
                  )
                )
                  close();
              }}
            />
          )}
          {sheet?.type === 'saved' && basket && (
            <KitEditor
              key={sheet.kit.id}
              kit={sheet.kit}
              busy={state.busy}
              onSave={async (title, items) => {
                if (
                  await state.run(
                    {
                      type: 'saved_edit',
                      basketId: basket.id,
                      id: sheet.kit.id,
                      revision: sheet.revision,
                      title,
                      items,
                    },
                    'Starting kit saved. Reset uses these items next time.',
                  )
                )
                  setSheet({ type: 'savedKits' });
              }}
            />
          )}
          {sheet?.type === 'reset' && (
            <Stack gap="lg">
              <Text>
                Start again with{' '}
                {sheet.basket.savedKits.reduce(
                  (sum, kit) => sum + kit.items.length,
                  0,
                )}{' '}
                unchecked items from {sheet.basket.savedKits.length} saved{' '}
                {sheet.basket.savedKits.length === 1 ? 'kit' : 'kits'}.
              </Text>
              <Text>
                One-off additions will be removed. Changed names will revert,
                and removed starting items will return. This resets the list for
                everyone.
              </Text>
              <Button
                loading={state.busy}
                leftSection={<RotateCcw size={18} />}
                onClick={() => {
                  void reset(sheet.basket);
                }}
              >
                Reset basket
              </Button>
              <Button variant="light" onClick={close}>
                Keep current list
              </Button>
            </Stack>
          )}
          {sheet?.type === 'archive' && (
            <Stack gap="lg">
              <Text>
                This archives “{sheet.basket.title}” for all{' '}
                {sheet.basket.members.length} people. Everything stays saved,
                and an owner can restore it later.
              </Text>
              <Button
                loading={state.busy}
                leftSection={<Archive size={18} />}
                onClick={() => {
                  void archive(sheet.basket);
                }}
              >
                Archive basket
              </Button>
              <Button variant="light" onClick={close}>
                Keep basket active
              </Button>
            </Stack>
          )}
          {sheet?.type === 'people' && basket && state.data && (
            <People
              basket={basket}
              userId={state.data.userId}
              busy={state.busy}
              run={state.run}
            />
          )}
          {sheet?.type === 'savedKits' && basket && (
            <SavedKits
              basket={basket}
              kits={personalKits}
              busy={state.busy}
              run={state.run}
              onCreate={() =>
                setSheet({
                  type: 'kit',
                  id: crypto.randomUUID(),
                  returnToSaved: true,
                })
              }
              onEdit={(id) => {
                const kit = basket.savedKits.find((entry) => entry.id === id);
                if (kit)
                  setSheet({ type: 'saved', kit, revision: basket.revision });
              }}
            />
          )}
          {sheet?.type === 'share' && basket && (
            <ShareBasket
              basket={basket}
              busy={state.busy}
              run={state.run}
              onStatus={state.setStatus}
              onError={state.setError}
            />
          )}
          {sheet?.type === 'settings' && basket && (
            <Stack gap="lg">
              <Text size="sm" c="dimmed">
                {basket.role === 'owner'
                  ? 'You’re an owner of this basket.'
                  : 'You’re a member of this basket.'}
              </Text>
              {owner ? (
                <>
                  <Text fw={600}>Join link</Text>
                  <Text size="sm">
                    {basket.linkId
                      ? 'A join link is active. Disabling it stops new people joining. Existing members keep access.'
                      : 'No active join link.'}
                  </Text>
                  <Button
                    variant="light"
                    disabled={!writable}
                    onClick={() => setSheet({ type: 'share' })}
                  >
                    {basket.linkId
                      ? 'Share or replace link'
                      : 'Create join link'}
                  </Button>
                  {basket.linkId && (
                    <Button
                      variant="subtle"
                      color="red"
                      disabled={!writable}
                      onClick={() => {
                        void state.run(
                          {
                            type: 'link_set',
                            basketId: basket.id,
                            id: crypto.randomUUID(),
                            token: null,
                          },
                          'Join link disabled. Existing members keep access.',
                        );
                      }}
                    >
                      Disable join link
                    </Button>
                  )}
                  <Divider />
                  <Text size="sm" c="dimmed">
                    Archive this basket from Basket actions when you’re
                    finished. Its contents and people stay saved.
                  </Text>
                </>
              ) : (
                <>
                  <Text>
                    Leaving removes your access to this basket. Everyone else
                    keeps their list.
                  </Text>
                  <Button
                    variant="light"
                    color="red"
                    loading={state.busy}
                    onClick={async () => {
                      if (
                        await state.run(
                          { type: 'leave', basketId: basket.id },
                          'You left the basket.',
                        )
                      )
                        go();
                    }}
                  >
                    Leave basket
                  </Button>
                </>
              )}
            </Stack>
          )}
          {sheet?.type === 'account' && client && (
            <AccountAccess
              client={client}
              guest={!state.user || !!state.user.is_anonymous}
              email={state.user?.email}
              onChanged={state.reload}
              onError={state.setError}
              onClose={close}
            />
          )}
          <Text
            className={classes.status}
            role="status"
            aria-live="polite"
            mt="md"
          >
            {state.status}
          </Text>
        </Drawer>
      </div>
    </MantineThemeProvider>
  );
}
