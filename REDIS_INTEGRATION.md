# 🔴 Redis Integration Guide for SalonMoney Backend

**Add Redis caching to improve performance and scalability**

---

## 🎯 Why Redis?

Currently, your backend uses `node-cache` (in-memory caching). While this works, it has limitations:

- ❌ Cache is lost when container restarts
- ❌ Doesn't scale across multiple instances
- ❌ Limited to single container memory

**Redis Benefits:**
- ✅ Persistent caching across restarts
- ✅ Scales horizontally (multiple backend instances)
- ✅ Advanced features (pub/sub, sessions, rate limiting)
- ✅ Lightning-fast performance

---

## 📋 What You'll Learn

1. How to add Redis database in Coolify
2. How to integrate Redis into your backend code
3. Best practices for caching strategies

---

## 🚀 Part 1: Add Redis to Coolify

### Step 1: Add Redis Resource

1. In Coolify, go to your **backend** project
2. Click **"+ Add Resource"** (same page shown in Screenshot 2)
3. Scroll to **"Databases"** section (visible in Screenshot 3)
4. Click on **"Redis"** tile

### Step 2: Configure Redis

Configure Redis settings:

| Setting | Value | Notes |
|---------|-------|-------|
| **Name** | `salonmoney-redis` | Descriptive name |
| **Environment** | `production` | Same as backend |
| **Redis Password** | `[GENERATE_STRONG]` | Auto-generated or custom |
| **Persistent Storage** | ✅ Enable | Prevents data loss |
| **Port** | `6379` | Default Redis port |
| **Public** | ❌ Disable | Only backend needs access |

### Step 3: Get Redis Connection URL

After creating Redis, Coolify will provide:

```
redis://:YOUR_PASSWORD@redis-hostname:6379
```

**Internal Connection Format (for Docker networks):**
```
redis://:YOUR_PASSWORD@salonmoney-redis:6379
```

Copy this URL - you'll need it for environment variables.

---

## 🔧 Part 2: Update Backend Code

### Step 1: Install Redis Client

Add Redis to your dependencies:

```bash
cd D:\leo\salonmoneynew\backend
npm install ioredis
```

Update `package.json`:
```json
{
  "dependencies": {
    ...
    "ioredis": "^5.3.2",
    ...
  }
}
```

### Step 2: Create Redis Client Configuration

Create new file: `config/redis.js`

```javascript
const Redis = require('ioredis');
const logger = require('../utils/logger');

// Redis configuration
const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  retryStrategy: (times) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  lazyConnect: false
};

// Create Redis client
const redisClient = new Redis(redisConfig);

// Connection events
redisClient.on('connect', () => {
  logger.info('Redis connected successfully');
});

redisClient.on('ready', () => {
  logger.info('Redis ready to accept commands');
});

redisClient.on('error', (err) => {
  logger.error('Redis connection error:', err);
});

redisClient.on('close', () => {
  logger.warn('Redis connection closed');
});

redisClient.on('reconnecting', () => {
  logger.info('Redis reconnecting...');
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM signal received: closing Redis connection');
  await redisClient.quit();
});

module.exports = redisClient;
```

### Step 3: Create Redis Cache Service

Create new file: `services/cacheService.js`

```javascript
const redisClient = require('../config/redis');
const logger = require('../utils/logger');

class CacheService {
  /**
   * Get value from cache
   * @param {string} key - Cache key
   * @returns {Promise<any>} - Cached value or null
   */
  async get(key) {
    try {
      const data = await redisClient.get(key);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      logger.error(`Cache GET error for key ${key}:`, error);
      return null;
    }
  }

  /**
   * Set value in cache
   * @param {string} key - Cache key
   * @param {any} value - Value to cache
   * @param {number} ttl - Time to live in seconds (default: 1 hour)
   */
  async set(key, value, ttl = 3600) {
    try {
      await redisClient.setex(key, ttl, JSON.stringify(value));
      logger.debug(`Cache SET: ${key} (TTL: ${ttl}s)`);
    } catch (error) {
      logger.error(`Cache SET error for key ${key}:`, error);
    }
  }

  /**
   * Delete key from cache
   * @param {string} key - Cache key
   */
  async del(key) {
    try {
      await redisClient.del(key);
      logger.debug(`Cache DEL: ${key}`);
    } catch (error) {
      logger.error(`Cache DEL error for key ${key}:`, error);
    }
  }

  /**
   * Delete multiple keys matching pattern
   * @param {string} pattern - Pattern to match (e.g., "user:*")
   */
  async delPattern(pattern) {
    try {
      const keys = await redisClient.keys(pattern);
      if (keys.length > 0) {
        await redisClient.del(...keys);
        logger.debug(`Cache DEL pattern: ${pattern} (${keys.length} keys)`);
      }
    } catch (error) {
      logger.error(`Cache DEL pattern error for ${pattern}:`, error);
    }
  }

  /**
   * Check if key exists
   * @param {string} key - Cache key
   * @returns {Promise<boolean>}
   */
  async exists(key) {
    try {
      const result = await redisClient.exists(key);
      return result === 1;
    } catch (error) {
      logger.error(`Cache EXISTS error for key ${key}:`, error);
      return false;
    }
  }

  /**
   * Increment counter
   * @param {string} key - Counter key
   * @returns {Promise<number>} - New value
   */
  async incr(key) {
    try {
      return await redisClient.incr(key);
    } catch (error) {
      logger.error(`Cache INCR error for key ${key}:`, error);
      return 0;
    }
  }

  /**
   * Set expiration on existing key
   * @param {string} key - Cache key
   * @param {number} ttl - Time to live in seconds
   */
  async expire(key, ttl) {
    try {
      await redisClient.expire(key, ttl);
    } catch (error) {
      logger.error(`Cache EXPIRE error for key ${key}:`, error);
    }
  }
}

module.exports = new CacheService();
```

### Step 4: Update Environment Variables

Add to Coolify environment variables:

```bash
REDIS_HOST=salonmoney-redis
REDIS_PORT=6379
REDIS_PASSWORD=your_redis_password_from_coolify
```

Or use full connection URL:
```bash
REDIS_URL=redis://:your_password@salonmoney-redis:6379
```

### Step 5: Example Usage - Cache Products

Update `routes/products.js` to use Redis caching:

```javascript
const express = require('express');
const router = express.Router();
const Product = require('../models/Product');
const cacheService = require('../services/cacheService');

// GET all products (with caching)
router.get('/', async (req, res) => {
  try {
    const cacheKey = 'products:all';

    // Try to get from cache first
    const cachedProducts = await cacheService.get(cacheKey);
    if (cachedProducts) {
      return res.json({
        success: true,
        data: cachedProducts,
        cached: true
      });
    }

    // If not in cache, fetch from database
    const products = await Product.find({ is_active: true }).sort({ name: 1 });

    // Cache for 30 minutes
    await cacheService.set(cacheKey, products, 1800);

    res.json({
      success: true,
      data: products,
      cached: false
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// When updating a product, invalidate cache
router.put('/:id', async (req, res) => {
  try {
    // Update product...
    const product = await Product.findByIdAndUpdate(req.params.id, req.body);

    // Invalidate product cache
    await cacheService.del('products:all');
    await cacheService.del(`product:${req.params.id}`);

    res.json({ success: true, data: product });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
```

---

## 🎯 Part 3: Caching Strategies

### What to Cache?

| Data Type | Cache Duration | Example |
|-----------|---------------|---------|
| **Products** | 30 minutes | VIP packages rarely change |
| **Exchange Rates** | 5 minutes | Updated every 4 hours via cron |
| **User Profiles** | 15 minutes | Updated occasionally |
| **Transaction Stats** | 1 hour | Calculated values |
| **Referral Data** | 10 minutes | Doesn't change often |

### Cache Key Naming Convention

Use structured keys for easy management:

```javascript
// Good naming patterns
user:123:profile          // User profile data
products:all              // All products list
product:VIP1:details      // Specific product
stats:daily:2025-12-14    // Daily statistics
rates:USDT:NSL            // Exchange rates
session:abc123            // User session
```

### Invalidation Patterns

```javascript
// Single key
await cacheService.del('user:123:profile');

// Pattern matching
await cacheService.delPattern('user:*');        // All user data
await cacheService.delPattern('products:*');    // All product caches
```

---

## 🚀 Part 4: Advanced Redis Features

### 1. Rate Limiting with Redis

Replace in-memory rate limiting:

```javascript
const rateLimit = require('express-rate-limit');
const RedisStore = require('rate-limit-redis');
const redisClient = require('./config/redis');

const limiter = rateLimit({
  store: new RedisStore({
    client: redisClient,
    prefix: 'rl:', // rate limit prefix
  }),
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});

app.use('/api/', limiter);
```

Install dependency:
```bash
npm install rate-limit-redis
```

### 2. Session Storage with Redis

Use Redis for session management:

```javascript
const session = require('express-session');
const RedisStore = require('connect-redis').default;

app.use(session({
  store: new RedisStore({ client: redisClient }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: true,
    httpOnly: true,
    maxAge: 1000 * 60 * 60 * 24 // 24 hours
  }
}));
```

Install dependency:
```bash
npm install express-session connect-redis
```

### 3. Real-time Analytics

Track real-time metrics:

```javascript
// Increment page views
await redisClient.incr('analytics:page_views');

// Track unique visitors (using sets)
await redisClient.sadd('analytics:visitors:today', userId);

// Get visitor count
const count = await redisClient.scard('analytics:visitors:today');
```

---

## 📊 Part 5: Monitoring Redis

### Health Check Endpoint

Add Redis health check:

```javascript
// In server.js or health route
app.get('/api/health', async (req, res) => {
  try {
    // Check MongoDB
    const mongoStatus = mongoose.connection.readyState === 1;

    // Check Redis
    const redisStatus = await redisClient.ping() === 'PONG';

    res.json({
      status: 'Server is running',
      timestamp: new Date(),
      services: {
        mongodb: mongoStatus ? 'connected' : 'disconnected',
        redis: redisStatus ? 'connected' : 'disconnected'
      }
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});
```

### Coolify Redis Monitoring

In Coolify dashboard:
- View Redis container logs
- Monitor memory usage
- Check connection count
- Review persistence status

---

## 🔐 Security Best Practices

1. **Use Strong Password**: Generate 32+ character password
2. **Disable Public Access**: Only internal Docker network
3. **Enable Persistence**: RDB + AOF for data safety
4. **Limit Memory**: Set `maxmemory` policy in Coolify
5. **Use SSL/TLS**: For production (if exposed externally)

---

## 🎯 Deployment Checklist

After adding Redis:

- [ ] Redis container running in Coolify
- [ ] Environment variables configured
- [ ] `ioredis` package installed
- [ ] Redis client configuration created
- [ ] Cache service implemented
- [ ] Routes updated to use caching
- [ ] Health check includes Redis status
- [ ] Code committed and pushed to GitHub
- [ ] Backend redeployed in Coolify
- [ ] Redis connection verified in logs

---

## 🐛 Troubleshooting

### Redis Connection Failed

**Check:**
- Redis container is running
- Environment variables are correct
- Docker network allows communication
- Password matches

**Test Connection:**
```bash
# In Coolify terminal (backend container)
npm install -g redis-cli
redis-cli -h salonmoney-redis -p 6379 -a YOUR_PASSWORD ping
```

Expected output: `PONG`

---

## 📚 Resources

- **ioredis Documentation**: https://github.com/redis/ioredis
- **Redis Commands**: https://redis.io/commands
- **Redis Best Practices**: https://redis.io/topics/best-practices
- **Coolify Redis**: https://coolify.io/docs/databases/redis

---

**Next Steps:**
1. Add Redis in Coolify (5 minutes)
2. Integrate Redis client in code (30 minutes)
3. Update routes to use caching (1-2 hours)
4. Test and deploy (30 minutes)

**Total Time:** ~2-3 hours for full Redis integration

---

**Pro Tip:** Start small - cache products first, then gradually add more caching as you see performance benefits!
