import { z } from 'zod';
import { isValidId } from '../../ids';
import { LINK_TYPES } from './destination';

export const PLACEMENTS = ['HEADER', 'FOOTER', 'SIDEBAR', 'MOBILE', 'CUSTOM'] as const;

const idStr = z.string().refine(isValidId, 'must be a positive BIGINT decimal string');
const name = z.string().trim().min(1).max(150);
const slug = z.string().trim().min(1).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'lowercase letters, digits and hyphens only');
const label = z.string().trim().min(1).max(120);
const a11y = z.string().trim().max(200).nullish();
const nonEmpty = (o: object) => Object.keys(o).length > 0;

// .strict() everywhere: tenantId/organizationId/createdBy/accessToken etc. in a body are rejected.
export const createMenuSchema = z.object({ name, slug, placement: z.enum(PLACEMENTS) }).strict();
export const patchMenuSchema = z
  .object({ name, slug, placement: z.enum(PLACEMENTS) })
  .partial()
  .strict()
  .refine(nonEmpty, 'At least one field is required.');

export const listMenusQuery = z
  .object({
    placement: z.enum(PLACEMENTS).optional(),
    status: z.enum(['DRAFT', 'PUBLISHED']).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    offset: z.coerce.number().int().min(0).default(0),
    sort: z.enum(['name', 'created_at', 'placement']).default('created_at'),
    order: z.enum(['asc', 'desc']).default('desc'),
  })
  .strict();

export const pageQuery = z
  .object({ limit: z.coerce.number().int().min(1).max(100).default(25), offset: z.coerce.number().int().min(0).default(0) })
  .strict();

const translation = z
  .object({
    locale: z.string().regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/, 'must be a BCP 47 style tag, e.g. en or fr-CA'),
    label,
    accessibilityLabel: a11y,
  })
  .strict();

const itemFields = {
  parentItemId: idStr.nullish(),
  label,
  itemKind: z.enum(['LINK', 'GROUP']),
  linkType: z.enum(LINK_TYPES).nullish(),
  targetPageId: idStr.nullish(),
  externalUrl: z.string().trim().max(2048).nullish(),
  anchor: z.string().trim().max(200).nullish(),
  systemRoute: z.string().trim().max(200).nullish(),
  sortOrder: z.number().int().min(0).max(1_000_000),
  openInNewTab: z.boolean(),
  accessibilityLabel: a11y,
  translations: z.array(translation).max(50).refine((l) => new Set(l.map((t) => t.locale)).size === l.length, 'duplicate locale'),
};

export const createItemSchema = z
  .object({ ...itemFields, sortOrder: itemFields.sortOrder.optional(), openInNewTab: itemFields.openInNewTab.optional(), translations: itemFields.translations.optional() })
  .strict();
export type CreateItemInput = z.infer<typeof createItemSchema>;

export const patchItemSchema = z.object(itemFields).partial().strict().refine(nonEmpty, 'At least one field is required.');
export type PatchItemInput = z.infer<typeof patchItemSchema>;

export const reorderSchema = z
  .object({
    items: z
      .array(z.object({ itemId: idStr, parentItemId: idStr.nullable(), sortOrder: z.number().int().min(0).max(1_000_000) }).strict())
      .min(1)
      .max(1000)
      .refine((l) => new Set(l.map((i) => i.itemId)).size === l.length, 'duplicate itemId'),
  })
  .strict();
export type ReorderInput = z.infer<typeof reorderSchema>;

export const revisionActionSchema = z.object({ revisionId: idStr }).strict();
export const createRevisionSchema = z.object({}).strict();
export const placementParam = z.enum(PLACEMENTS);
