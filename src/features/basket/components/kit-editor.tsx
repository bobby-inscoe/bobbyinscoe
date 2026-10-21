import {
  ActionIcon,
  Button,
  Group,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { Plus, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { classes } from '@/features/basket/theme/basket-theme';
import type {
  DefinitionItem,
  Kit,
  SavedKit,
} from '@/features/basket/types/contracts';

export function KitEditor({
  kit,
  busy,
  onSave,
  onDelete,
}: {
  kit?: Kit | SavedKit;
  busy: boolean;
  onSave: (title: string, items: DefinitionItem[]) => Promise<void>;
  onDelete?: () => void;
}) {
  const [title, setTitle] = useState(kit?.title ?? '');
  const [items, setItems] = useState<DefinitionItem[]>(
    kit?.items ?? [{ id: crypto.randomUUID(), text: '' }],
  );
  const focusItem = useRef<string | null>(null);
  const [error, setError] = useState('');
  function addItem(after = items.length - 1) {
    if (busy || items.length >= 100) return;
    const item = { id: crypto.randomUUID(), text: '' };
    focusItem.current = item.id;
    setItems((current) => [
      ...current.slice(0, after + 1),
      item,
      ...current.slice(after + 1),
    ]);
  }
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (busy) return;
        const filled = items
          .map((item) => ({ ...item, text: item.text.trim() }))
          .filter((item) => item.text);
        if (!filled.length) {
          setError('Add at least one item to this kit.');
          return;
        }
        setError('');
        void onSave(title.trim(), filled);
      }}
    >
      <Stack gap="lg">
        <TextInput
          label="Kit name"
          placeholder="Grocery staples"
          value={title}
          onChange={(event) => setTitle(event.currentTarget.value)}
          required
          maxLength={80}
          data-autofocus
        />
        <Text size="sm" c="dimmed">
          Starting items for your next round. Checklist edits never change
          these.
        </Text>
        <Stack gap="sm">
          {items.map((item, index) => (
            <div className={classes.definitionRow} key={item.id}>
              <TextInput
                className={classes.grow}
                label={`Item ${index + 1}`}
                value={item.text}
                ref={(input) => {
                  if (input && focusItem.current === item.id) {
                    input.focus();
                    focusItem.current = null;
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    addItem(index);
                  }
                }}
                maxLength={240}
                onChange={(event) => {
                  const text = event.currentTarget.value;
                  setItems((current) =>
                    current.map((row) =>
                      row.id === item.id ? { ...row, text } : row,
                    ),
                  );
                }}
              />
              <ActionIcon
                variant="subtle"
                color="red"
                aria-label={`Remove item ${index + 1}`}
                disabled={busy || items.length === 1}
                onClick={() =>
                  setItems((current) =>
                    current.filter((row) => row.id !== item.id),
                  )
                }
              >
                <Trash2 size={18} />
              </ActionIcon>
            </div>
          ))}
        </Stack>
        <Button
          variant="light"
          leftSection={<Plus size={18} />}
          disabled={busy || items.length >= 100}
          onClick={() => addItem()}
        >
          Add another item
        </Button>
        {error && (
          <Text role="alert" c="red">
            {error}
          </Text>
        )}
        <Group justify="space-between">
          {onDelete && (
            <Button
              variant="subtle"
              color="red"
              onClick={onDelete}
              disabled={busy}
            >
              Delete personal kit
            </Button>
          )}
          <Button type="submit" loading={busy}>
            Save kit
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
