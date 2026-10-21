import { z } from 'zod';

export const idSchema = z.uuid();
export const textSchema = z.string().trim().min(1).max(240);
export const titleSchema = z.string().trim().min(1).max(80);
export const nameSchema = z.string().trim().min(1).max(60);
export const tokenSchema = z.string().regex(/^[a-f0-9]{64}$/);
const definitionItem = z.strictObject({ id: idSchema, text: textSchema });
const definition = {
  title: titleSchema,
  items: z.array(definitionItem).min(1).max(100),
};
const version = z.number().int().positive();
const role = z.enum(['owner', 'member']);
export const kitSchema = z.strictObject({
  id: idSchema,
  revision: version,
  ...definition,
});
export const savedKitSchema = z.strictObject({ id: idSchema, ...definition });
export const itemSchema = z.strictObject({
  id: idSchema,
  text: textSchema,
  completed: z.boolean(),
  revision: version,
  sourceId: idSchema.nullable(),
});
export const basketSchema = z.strictObject({
  id: idSchema,
  title: titleSchema,
  revision: version,
  archived: z.boolean(),
  role,
  members: z
    .array(z.strictObject({ id: idSchema, name: nameSchema, role }))
    .max(100),
  items: z.array(itemSchema).max(1000),
  savedKits: z.array(savedKitSchema).max(10),
  linkId: idSchema.nullable(),
});
export const snapshotSchema = z.strictObject({
  userId: idSchema,
  baskets: z.array(
    z.strictObject({
      id: idSchema,
      title: titleSchema,
      archived: z.boolean(),
      role,
      revision: version,
      peopleCount: z.number().int().min(1).max(100),
    }),
  ),
  kits: z.array(kitSchema),
  basket: basketSchema.nullable(),
});
const basketId = { basketId: idSchema };
const row = { ...basketId, id: idSchema };
export const actionSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('create'),
    id: idSchema,
    title: titleSchema,
    name: nameSchema,
  }),
  z.strictObject({
    type: z.literal('join'),
    token: tokenSchema,
    name: nameSchema,
  }),
  z.strictObject({
    type: z.literal('rename'),
    ...basketId,
    title: titleSchema,
    revision: version,
  }),
  z.strictObject({
    type: z.literal('archive'),
    ...basketId,
    archived: z.boolean(),
    revision: version,
  }),
  z.strictObject({ type: z.literal('item_add'), ...row, text: textSchema }),
  z.strictObject({
    type: z.literal('item_edit'),
    ...row,
    text: textSchema,
    revision: version,
  }),
  z.strictObject({
    type: z.literal('item_check'),
    ...row,
    completed: z.boolean(),
  }),
  z.strictObject({ type: z.literal('item_remove'), ...row, revision: version }),
  z.strictObject({
    type: z.literal('kit_save'),
    id: idSchema,
    revision: version.optional(),
    ...definition,
  }),
  z.strictObject({
    type: z.literal('kit_delete'),
    id: idSchema,
    revision: version,
  }),
  z.strictObject({ type: z.literal('kit_attach'), ...row, kitId: idSchema }),
  z.strictObject({
    type: z.literal('saved_edit'),
    ...row,
    revision: version,
    ...definition,
  }),
  z.strictObject({
    type: z.literal('saved_remove'),
    ...row,
    revision: version,
  }),
  z.strictObject({ type: z.literal('reset'), ...basketId, revision: version }),
  z.strictObject({
    type: z.literal('link_set'),
    ...row,
    token: tokenSchema.nullable(),
  }),
  z.strictObject({
    type: z.literal('person'),
    ...row,
    role: z.enum(['owner', 'member', 'removed']),
    revision: version,
  }),
  z.strictObject({ type: z.literal('leave'), ...basketId }),
  z.strictObject({ type: z.literal('handover_prepare'), token: tokenSchema }),
  z.strictObject({ type: z.literal('handover_finish'), token: tokenSchema }),
]);
export const searchSchema = z.object({
  basket: idSchema.optional(),
});
export type Action = z.infer<typeof actionSchema>;
export type Snapshot = z.infer<typeof snapshotSchema>;
export type Basket = z.infer<typeof basketSchema>;
export type Kit = z.infer<typeof kitSchema>;
export type SavedKit = z.infer<typeof savedKitSchema>;
export type Item = z.infer<typeof itemSchema>;
export type DefinitionItem = z.infer<typeof definitionItem>;

export function changedKitItems(basket: Basket) {
  const starting = new Map(
    basket.savedKits.flatMap((kit) =>
      kit.items.map((item) => [item.id, item.text] as const),
    ),
  );
  return basket.items.filter(
    (item) =>
      item.sourceId &&
      starting.has(item.sourceId) &&
      starting.get(item.sourceId) !== item.text,
  ).length;
}
