import { describe, expect, it } from 'vitest';
import { compareIds, isValidId } from '../../src/ids';

describe('BIGINT ids', () => {
  it('accepts decimal strings up to int64 max', () => {
    expect(isValidId('1')).toBe(true);
    expect(isValidId('9007199254740993')).toBe(true);
    expect(isValidId('9223372036854775807')).toBe(true);
  });
  it('rejects malformed, negative, zero, numeric and out-of-range values', () => {
    for (const v of ['0', '-1', '01', '1.5', 'abc', '', '9223372036854775808', 12, null, undefined]) {
      expect(isValidId(v)).toBe(false);
    }
  });
  it('compares exactly beyond Number.MAX_SAFE_INTEGER', () => {
    expect(compareIds('9007199254740993', '9007199254740992')).toBe(1);
    expect(compareIds('9007199254740992', '9007199254740993')).toBe(-1);
  });
});
