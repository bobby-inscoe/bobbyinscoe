import { z } from 'zod';

export const NOTE_MAX_LENGTH = 2000;

export const noteSchema = z.strictObject({
  userId: z.uuid(),
  body: z.string().max(NOTE_MAX_LENGTH),
  revision: z.number().int().positive(),
  editedAt: z.iso.datetime({ offset: true }),
});

export type ListingNote = z.infer<typeof noteSchema>;

export class NoteConflictError extends Error {
  constructor() {
    super('This note changed since you loaded it.');
    this.name = 'NoteConflictError';
  }
}
