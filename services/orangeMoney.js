const axios = require('axios');

const ORANGE_API_BASE  = process.env.ORANGE_API_BASE  || 'https://api.orange.com/orange-money-webpay/dev/v1';
const ORANGE_TOKEN_URL = 'https://api.orange.com/oauth/v3/token';
const ORANGE_AUTH_KEY  = process.env.ORANGE_AUTH_KEY;
const MERCHANT_MSISDN  = process.env.ORANGE_MERCHANT_MSISDN;
const CURRENCY         = process.env.ORANGE_CURRENCY || 'SLL';

async function getAccessToken() {
  const { data } = await axios.post(
    ORANGE_TOKEN_URL,
    'grant_type=client_credentials',
    {
      headers: {
        Authorization: `Basic ${ORANGE_AUTH_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      timeout: 15000,
    }
  );
  return data.access_token;
}

async function initiateDeposit({ orderId, amountSLL, returnUrl, cancelUrl, notifUrl }) {
  const token = await getAccessToken();
  const { data } = await axios.post(
    `${ORANGE_API_BASE}/webpayment`,
    {
      merchant_key:  ORANGE_AUTH_KEY,
      currency:      CURRENCY,
      order_id:      orderId,
      amount:        amountSLL,
      return_url:    returnUrl,
      cancel_url:    cancelUrl,
      notif_url:     notifUrl,
      lang:          'en',
      reference:     orderId,
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      timeout: 15000,
    }
  );
  return data; // { pay_token, payment_url, message, ... }
}

async function getPaymentStatus(payToken) {
  const token = await getAccessToken();
  const { data } = await axios.get(
    `${ORANGE_API_BASE}/webpayment/${payToken}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
      timeout: 15000,
    }
  );
  return data;
}

async function initiateTransfer({ recipientMSISDN, amountSLL, orderId, description }) {
  const token = await getAccessToken();
  const { data } = await axios.post(
    `${ORANGE_API_BASE}/transfer`,
    {
      merchant_key:      ORANGE_AUTH_KEY,
      customer_msisdn:   recipientMSISDN,
      merchant_msisdn:   MERCHANT_MSISDN,
      amount:            amountSLL,
      currency:          CURRENCY,
      order_id:          orderId,
      description:       description || 'Gold Mine withdrawal',
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      timeout: 15000,
    }
  );
  return data;
}

module.exports = { getAccessToken, initiateDeposit, getPaymentStatus, initiateTransfer };
