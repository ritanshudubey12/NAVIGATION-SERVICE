import { describe, expect, it } from 'vitest';
import { normalizeDestination } from '../../src/modules/navigation/destination';

const opts = { systemRoutes: ['/login', '/cart'] };

describe('normalizeDestination', () => {
  it('accepts https external URLs', () => {
    const d = normalizeDestination({ itemKind: 'LINK', linkType: 'EXTERNAL_URL', externalUrl: 'https://partner.example' }, opts, false);
    expect(d.externalUrl).toBe('https://partner.example');
  });
  it.each(['javascript:alert(1)', 'data:text/html,hi', 'vbscript:x', 'file:///etc/passwd', 'not a url'])('rejects unsafe/invalid URL %s', (u) => {
    expect(() => normalizeDestination({ itemKind: 'LINK', linkType: 'EXTERNAL_URL', externalUrl: u }, opts, false)).toThrow();
  });
  it('rejects credentials inside URLs', () => {
    expect(() => normalizeDestination({ itemKind: 'LINK', linkType: 'EXTERNAL_URL', externalUrl: 'https://u:p@x.example' }, opts, false)).toThrow();
  });
  it('normalizes anchors and validates them', () => {
    expect(normalizeDestination({ itemKind: 'LINK', linkType: 'ANCHOR', anchor: '#contact' }, opts, false).anchor).toBe('contact');
    expect(() => normalizeDestination({ itemKind: 'LINK', linkType: 'ANCHOR', anchor: '#<x>' }, opts, false)).toThrow();
  });
  it('only allows approved system routes', () => {
    expect(normalizeDestination({ itemKind: 'LINK', linkType: 'APPROVED_SYSTEM_ROUTE', systemRoute: '/cart' }, opts, false).systemRoute).toBe('/cart');
    expect(() => normalizeDestination({ itemKind: 'LINK', linkType: 'APPROVED_SYSTEM_ROUTE', systemRoute: '/admin' }, opts, false)).toThrow();
  });
  it('requires linkType for LINK and forbids destinations on GROUP', () => {
    expect(() => normalizeDestination({ itemKind: 'LINK' }, opts, false)).toThrow();
    expect(() => normalizeDestination({ itemKind: 'GROUP', externalUrl: 'https://x.example' }, opts, false)).toThrow();
    expect(normalizeDestination({ itemKind: 'GROUP' }, opts, false).linkType).toBeNull();
  });
  it('rejects mismatched fields on create but prunes them on merge', () => {
    const input = { itemKind: 'LINK' as const, linkType: 'INTERNAL_PAGE' as const, targetPageId: '1', externalUrl: 'https://x.example' };
    expect(() => normalizeDestination(input, opts, false)).toThrow();
    expect(normalizeDestination(input, opts, true).externalUrl).toBeNull();
  });
  it('keeps BIGINT page ids exact', () => {
    expect(normalizeDestination({ itemKind: 'LINK', linkType: 'INTERNAL_PAGE', targetPageId: '9007199254741001' }, opts, false).targetPageId).toBe('9007199254741001');
  });
});
