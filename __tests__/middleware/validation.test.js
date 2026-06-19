const {
  validateUpdateProfile,
  validateUpdateBalance,
} = require('../../middleware/validation');
const { mockRequest, mockResponse, mockNext } = require('../helpers/testUtils');

describe('validation middleware', () => {
  test('strips unknown profile fields before route handlers receive req.body', () => {
    const req = mockRequest({
      username: 'newuser',
      email: 'USER@EXAMPLE.COM',
      role: 'superadmin',
      balance_NSL: 999999,
      profile_photo: '../secret.png',
      password_hash: 'hacked',
    });
    const res = mockResponse();
    const next = mockNext();

    validateUpdateProfile(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    expect(req.body).toEqual({
      username: 'newuser',
      email: 'user@example.com',
    });
  });

  test('strips unknown admin balance fields before route handlers receive req.body', () => {
    const req = mockRequest({
      action: 'add',
      currency: 'NSL',
      amount: '10.99',
      reason: 'manual adjustment',
      user_id: 1,
      role: 'superadmin',
      approved_by: 1,
    });
    const res = mockResponse();
    const next = mockNext();

    validateUpdateBalance(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    expect(req.body).toEqual({
      action: 'add',
      currency: 'NSL',
      amount: 10.99,
      reason: 'manual adjustment',
    });
  });
});
