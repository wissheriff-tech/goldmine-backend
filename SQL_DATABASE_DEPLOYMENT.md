# SQL Database Deployment

The current backend uses Sequelize SQL models. Production reads `DATABASE_URL` from the environment and selects the dialect from that URL:

- `postgres://` or `postgresql://` uses PostgreSQL.
- `mysql://` or `mysql2://` uses MySQL.
- Local development falls back to SQLite at `backend/data/salonmoney.db` when `DATABASE_URL` is not set.

Required production environment variables:

```env
DATABASE_URL=your-sql-database-url
JWT_SECRET=your-secure-jwt-secret
NODE_ENV=production
FRONTEND_URL=https://your-frontend-domain
```

Use the active seed scripts when setting up SQL data:

```bash
npm run seed:admin
npm run seed:products
npm run seed:currencies
```

Do not add legacy NoSQL connection strings or seed scripts. They are no longer part of the runtime backend.
