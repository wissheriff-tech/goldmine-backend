# SalonMoney Database Setup for Railway

## Railway MySQL Connection

**Connection String:**
```
mysql://root:CdcnQNLfAuXzpZEiaBeNjAbRuECldnQU@yamanote.proxy.rlwy.net:41765/railway
```

## Database Files

| File | Description |
|------|-------------|
| `init_railway.sql` | Complete SQL schema with all tables and default data |
| `init-database.js` | Node.js script to initialize database programmatically |

## Quick Setup

### Option 1: Using Node.js Script (Recommended)

```bash
cd backend
npm install
node database/init-database.js
```

### Option 2: Using SQL File Directly

Connect to Railway MySQL using any MySQL client:

```bash
mysql -h yamanote.proxy.rlwy.net -P 41765 -u root -p railway < database/init_railway.sql
```

Password: `CdcnQNLfAuXzpZEiaBeNjAbRuECldnQU`

## Super Admin Credentials

After initialization, use these credentials to log in:

| Field | Value |
|-------|-------|
| **Username** | `Wisradom` |
| **Password** | `Norman@1995?.` |
| **Role** | `superadmin` |

## Database Tables

The database includes 14 tables:

1. **users** - User accounts, authentication, KYC, balances
2. **products** - VIP packages (VIP0-VIP9)
3. **user_products** - User-product relationships
4. **transactions** - Recharge, withdrawal, income records
5. **withdrawal_addresses** - User crypto addresses
6. **sessions** - User session management
7. **chats** - Support chat sessions
8. **chat_messages** - Chat message history
9. **notifications** - User notifications
10. **referrals** - Referral program tracking
11. **two_factor_auth** - 2FA configuration
12. **exchange_rates** - Currency exchange rates
13. **currency_rates** - NSL conversion rates
14. **deposit_proofs** - Deposit verification records

## Default Data

The initialization includes:

- **1 Super Admin** (Wisradom)
- **10 VIP Products** (VIP0-VIP9)
- **10 Exchange Rates** (USD, EUR, GBP, NGN, KES, GHS, ZAR, INR, CNY, JPY)
- **8 Currency Rates** (for NSL conversion)

## Vercel Deployment

When deploying the backend to Vercel, add this environment variable:

```
DATABASE_URL=mysql://root:CdcnQNLfAuXzpZEiaBeNjAbRuECldnQU@yamanote.proxy.rlwy.net:41765/railway
```

## Troubleshooting

### Connection Timeout
If you experience connection timeouts, ensure:
- Railway MySQL service is running
- Your IP is not blocked
- The connection string is correct

### Table Already Exists
The `init-database.js` script uses `force: true` which drops existing tables.
If you don't want to lose data, modify the script to use `alter: true` instead.
