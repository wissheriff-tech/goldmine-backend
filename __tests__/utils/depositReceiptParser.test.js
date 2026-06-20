const {
  sanitizeReceiptSubmission,
  validateDepositReceipt,
} = require('../../utils/depositReceiptParser');

describe('deposit receipt parser', () => {
  test('extracts and validates Orange Money receipt details', () => {
    const receipt = sanitizeReceiptSubmission({
      provider: 'orange_money',
      ocr_text: `
        Orange Money
        Sender: 076 123 456
        Receiver: 088 333 222
        Amount NSL 5,000
        ReferenceCI260606.1351.B51366
        2026-06-20 13:51
      `,
    });

    expect(receipt.provider).toBe('orange_money');
    expect(receipt.amount).toBe(5000);
    expect(receipt.currency).toBe('NSL');
    expect(receipt.reference_id).toBe('CI260606.1351.B51366');
    expect(receipt.sender_number).toBe('076123456');
    expect(validateDepositReceipt(receipt).valid).toBe(true);
  });

  test('extracts Binance proof details from tx hash and USDT amount', () => {
    const receipt = sanitizeReceiptSubmission({
      provider: 'binance',
      ocr_text: `
        Binance USDT TRC20 transfer completed
        Tx Hash: 7f8a9b0c1d2e3f4a5b6c7d8e9f00112233445566778899aabbccddeeff001122
        Total: 25.50 USDT
      `,
    });

    expect(receipt.provider).toBe('binance');
    expect(receipt.amount).toBe(25.5);
    expect(receipt.currency).toBe('USDT');
    expect(receipt.reference_id).toBe('7f8a9b0c1d2e3f4a5b6c7d8e9f00112233445566778899aabbccddeeff001122');
    expect(validateDepositReceipt(receipt).valid).toBe(true);
  });

  test('strips script-like OCR content and rejects incomplete mobile receipts', () => {
    const receipt = sanitizeReceiptSubmission({
      provider: 'africell',
      ocr_text: '<script>alert(1)</script> Amount SLE 2000 Reference MP2606062049B07097',
    });
    const validation = validateDepositReceipt(receipt);

    expect(receipt.reference_id).not.toContain('<');
    expect(receipt.reference_id).not.toContain('script');
    expect(receipt.amount).toBe(2000);
    expect(validation.valid).toBe(false);
    expect(validation.errors).toContain('Mobile money number could not be read from the screenshot.');
  });
});
