import { badRequest } from '../../errors';

export const LINK_TYPES = ['INTERNAL_PAGE', 'EXTERNAL_URL', 'ANCHOR', 'APPROVED_SYSTEM_ROUTE'] as const;
export type LinkType = (typeof LINK_TYPES)[number];

export interface DestinationInput {
  itemKind: 'LINK' | 'GROUP';
  linkType?: LinkType | null;
  targetPageId?: string | null;
  externalUrl?: string | null;
  anchor?: string | null;
  systemRoute?: string | null;
}
export interface Destination {
  itemKind: 'LINK' | 'GROUP';
  linkType: LinkType | null;
  targetPageId: string | null;
  externalUrl: string | null;
  anchor: string | null;
  systemRoute: string | null;
}

const SAFE_PROTOCOLS = new Set(['https:', 'http:', 'mailto:', 'tel:']);
const FIELD_BY_TYPE: Record<LinkType, keyof Destination> = {
  INTERNAL_PAGE: 'targetPageId',
  EXTERNAL_URL: 'externalUrl',
  ANCHOR: 'anchor',
  APPROVED_SYSTEM_ROUTE: 'systemRoute',
};
const present = (v: unknown) => typeof v === 'string' && v.trim() !== '';

// Validates and normalizes a destination. With prune=true (PATCH merges) fields that do not
// belong to the link type are dropped; with prune=false (create) they are rejected.
export function normalizeDestination(
  input: DestinationInput,
  opts: { systemRoutes: string[] },
  prune: boolean,
): Destination {
  const out: Destination = {
    itemKind: input.itemKind, linkType: null, targetPageId: null, externalUrl: null, anchor: null, systemRoute: null,
  };
  const given = { targetPageId: input.targetPageId, externalUrl: input.externalUrl, anchor: input.anchor, systemRoute: input.systemRoute };

  if (input.itemKind === 'GROUP') {
    if (!prune && (input.linkType || Object.values(given).some(present))) {
      throw badRequest('GROUP items cannot have a link destination.');
    }
    return out;
  }
  if (!input.linkType) throw badRequest('linkType is required for LINK items.');
  out.linkType = input.linkType;
  const own = FIELD_BY_TYPE[input.linkType];
  if (!prune) {
    for (const [field, value] of Object.entries(given)) {
      if (field !== own && present(value)) throw badRequest(`${field} is not allowed for linkType ${input.linkType}.`);
    }
  }
  const value = (given as Record<string, string | null | undefined>)[own as string];
  if (!present(value)) throw badRequest(`${own as string} is required for linkType ${input.linkType}.`);
  const v = (value as string).trim();

  switch (input.linkType) {
    case 'INTERNAL_PAGE':
      out.targetPageId = v;
      break;
    case 'EXTERNAL_URL': {
      let url: URL;
      try {
        url = new URL(v);
      } catch {
        throw badRequest('externalUrl must be an absolute URL.');
      }
      if (!SAFE_PROTOCOLS.has(url.protocol)) {
        throw badRequest('externalUrl scheme is not allowed (use https, http, mailto or tel).');
      }
      if (url.username || url.password) throw badRequest('externalUrl must not contain credentials.');
      out.externalUrl = v;
      break;
    }
    case 'ANCHOR': {
      const name = v.replace(/^#/, '');
      if (!/^[A-Za-z][\w:.-]{0,199}$/.test(name)) throw badRequest('anchor is not a valid fragment identifier.');
      out.anchor = name;
      break;
    }
    case 'APPROVED_SYSTEM_ROUTE':
      if (!opts.systemRoutes.includes(v)) throw badRequest('systemRoute is not an approved system route.');
      out.systemRoute = v;
      break;
  }
  return out;
}
