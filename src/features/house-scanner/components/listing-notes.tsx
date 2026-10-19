import { Alert, Button, Group, Stack, Text, Textarea } from '@mantine/core';
import { useEffect, useRef } from 'react';

import type { ListingNotesController } from '@/features/house-scanner/hooks/use-listing-notes';
import type { Member } from '@/features/house-scanner/types/contracts';
import { NOTE_MAX_LENGTH } from '@/features/house-scanner/types/notes';
import { formatDate } from '@/features/house-scanner/utils/format';

interface ListingNotesProps {
  controller?: ListingNotesController;
  members: Member[];
  userId: string;
}

export function ListingNotes({
  controller,
  members,
  userId,
}: ListingNotesProps) {
  const conflictRegion = useRef<HTMLDivElement>(null);
  const conflict = controller?.conflict ?? false;
  useEffect(() => {
    if (conflict) conflictRegion.current?.focus();
  }, [conflict]);
  if (!controller || controller.status === 'unavailable')
    return <Text size="sm">Shared notes are unavailable in this view.</Text>;
  const memberName = (id: string) =>
    members.find((member) => member.userId === id)?.displayName ||
    'Household member';
  return (
    <Stack gap="xs" aria-label="Shared notes" component="section">
      {controller.status === 'loading' && (
        <Text size="sm" role="status">
          Loading notes…
        </Text>
      )}
      {controller.status === 'error' && (
        <Alert role="alert" color="red">
          <Group gap="sm">
            <Text size="sm">Notes could not be loaded.</Text>
            <Button size="xs" variant="default" onClick={controller.retry}>
              Retry
            </Button>
          </Group>
        </Alert>
      )}
      {controller.status === 'ready' && (
        <>
          {controller.notes.length ? (
            <ul aria-label="Household notes">
              {controller.notes.map((note) => (
                <li key={note.userId}>
                  <Text size="sm" fw={600}>
                    {note.userId === userId
                      ? `You (${memberName(note.userId)})`
                      : memberName(note.userId)}{' '}
                    · edited {formatDate(note.editedAt)}
                  </Text>
                  <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
                    {note.body || 'This note is empty.'}
                  </Text>
                </li>
              ))}
            </ul>
          ) : (
            <Text size="sm">No notes yet.</Text>
          )}
          {controller.conflict && (
            <Alert
              ref={conflictRegion}
              role="alert"
              tabIndex={-1}
              color="yellow"
              title="Your note changed since you opened it"
            >
              <Stack gap="xs">
                <Text size="sm">
                  Latest saved note:{' '}
                  {controller.ownNote?.body || 'No saved note.'}
                </Text>
                <Group>
                  <Button
                    size="xs"
                    loading={controller.saving}
                    onClick={controller.keepDraftAndSave}
                  >
                    Keep my draft and save over latest
                  </Button>
                  <Button
                    size="xs"
                    variant="default"
                    disabled={controller.saving}
                    onClick={controller.discardDraft}
                  >
                    Use latest and discard my draft
                  </Button>
                </Group>
              </Stack>
            </Alert>
          )}
          <Textarea
            label="Your shared note"
            description={`${controller.draft.length} of ${NOTE_MAX_LENGTH} characters`}
            value={controller.draft}
            maxLength={NOTE_MAX_LENGTH}
            rows={4}
            onChange={(event) => controller.setDraft(event.currentTarget.value)}
          />
          <Group>
            <Button
              size="xs"
              disabled={!controller.dirty || controller.conflict}
              loading={controller.saving && !controller.conflict}
              onClick={controller.save}
            >
              Save note
            </Button>
          </Group>
        </>
      )}
      <Text size="sm" role="status">
        {controller.result}
      </Text>
    </Stack>
  );
}
