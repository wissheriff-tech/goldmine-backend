const { sanitizeMetadata } = require('../../utils/adminAudit');

describe('admin audit utilities', () => {
  test('redacts sensitive metadata before persistence', () => {
    const sanitized = sanitizeMetadata({
      action: 'reset',
      password: 'Secret123!',
      nested: {
        refreshToken: 'token-value',
        amount: 10,
      },
      notes: 'safe note',
    });

    expect(sanitized).toEqual({
      action: 'reset',
      password: '[redacted]',
      nested: {
        refreshToken: '[redacted]',
        amount: 10,
      },
      notes: 'safe note',
    });
  });
});
