import { Alert, Button, Group, Stack, Text, Textarea } from '@mantine/core';
import { useEffect, useRef } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import type { ListingNotesController } from '@/features/house-scanner/hooks/use-listing-notes';
import {
  formatFeedback,
  messageValue,
} from '@/features/house-scanner/i18n/catalogs';
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
  const intl = useIntl();

  const conflictRegion = useRef<HTMLDivElement>(null);
  const conflict = controller?.conflict ?? false;
  useEffect(() => {
    if (conflict) conflictRegion.current?.focus();
  }, [conflict]);
  if (!controller || controller.status === 'unavailable')
    return (
      <Text size="sm">
        <FormattedMessage id="listings.details.sharedNotesAreUnavailableInThisView" />
      </Text>
    );
  const memberName = (id: string) =>
    members.find((member) => member.userId === id)?.displayName ||
    intl.formatMessage({ id: 'listings.details.householdMember' });
  return (
    <Stack
      gap="xs"
      aria-label={intl.formatMessage({ id: 'listings.details.sharedNotes' })}
      component="section"
    >
      {controller.status === 'loading' && (
        <Text size="sm" role="status">
          <FormattedMessage id="listings.details.loadingNotes" />
        </Text>
      )}
      {controller.status === 'error' && (
        <Alert role="alert" color="red">
          <Group gap="sm">
            <Text size="sm">
              <FormattedMessage id="listings.details.notesCouldNotBeLoaded" />
            </Text>
            <Button size="xs" variant="default" onClick={controller.retry}>
              <FormattedMessage id="common.retry" />
            </Button>
          </Group>
        </Alert>
      )}
      {controller.status === 'ready' && (
        <>
          {controller.notes.length ? (
            <ul
              aria-label={intl.formatMessage({
                id: 'listings.details.householdNotes',
              })}
            >
              {controller.notes.map((note) => (
                <li key={note.userId}>
                  <Text size="sm" fw={600}>
                    <FormattedMessage
                      id="listings.details.edited"
                      values={{
                        value0: messageValue(
                          note.userId === userId
                            ? intl.formatMessage(
                                { id: 'listings.details.you' },
                                {
                                  value0: messageValue(memberName(note.userId)),
                                },
                              )
                            : memberName(note.userId),
                        ),
                        value1: messageValue(formatDate(note.editedAt, intl)),
                      }}
                    />
                  </Text>
                  <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
                    {note.body ||
                      intl.formatMessage({
                        id: 'listings.details.thisNoteIsEmpty',
                      })}
                  </Text>
                </li>
              ))}
            </ul>
          ) : (
            <Text size="sm">
              <FormattedMessage id="listings.details.noNotesYet" />
            </Text>
          )}
          {controller.conflict && (
            <Alert
              ref={conflictRegion}
              role="alert"
              tabIndex={-1}
              color="yellow"
              title={intl.formatMessage({
                id: 'listings.details.yourNoteChangedSinceYouOpenedIt',
              })}
            >
              <Stack gap="xs">
                <Text size="sm">
                  <FormattedMessage
                    id="listings.details.latestSavedNote"
                    values={{
                      value0: messageValue(
                        controller.ownNote?.body ||
                          intl.formatMessage({
                            id: 'listings.details.noSavedNote',
                          }),
                      ),
                    }}
                  />
                </Text>
                <Group>
                  <Button
                    size="xs"
                    loading={controller.saving}
                    onClick={controller.keepDraftAndSave}
                  >
                    <FormattedMessage id="listings.details.keepMyDraftAndSaveOverLatest" />
                  </Button>
                  <Button
                    size="xs"
                    variant="default"
                    disabled={controller.saving}
                    onClick={controller.discardDraft}
                  >
                    <FormattedMessage id="listings.details.useLatestAndDiscardMyDraft" />
                  </Button>
                </Group>
              </Stack>
            </Alert>
          )}
          <Textarea
            label={intl.formatMessage({
              id: 'listings.details.yourSharedNote',
            })}
            description={intl.formatMessage(
              { id: 'listings.details.ofCharacters' },
              {
                value0: messageValue(controller.draft.length),
                value1: messageValue(NOTE_MAX_LENGTH),
              },
            )}
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
              <FormattedMessage id="listings.details.saveNote" />
            </Button>
          </Group>
        </>
      )}
      <Text size="sm" role="status">
        {formatFeedback(intl, controller.result)}
      </Text>
    </Stack>
  );
}
