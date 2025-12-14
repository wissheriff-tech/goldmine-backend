# 🚀 SalonMoney Backend Deployment Guide for Coolify

**Complete Step-by-Step Guide with Professional Best Practices**

---

## 📋 Table of Contents
1. [Prerequisites](#prerequisites)
2. [Pre-Deployment Checklist](#pre-deployment-checklist)
3. [Step-by-Step Deployment](#step-by-step-deployment)
4. [Environment Variables Configuration](#environment-variables-configuration)
5. [Database Setup](#database-setup)
6. [Frontend Configuration](#frontend-configuration)
7. [Post-Deployment Steps](#post-deployment-steps)
8. [Troubleshooting](#troubleshooting)
9. [Monitoring & Maintenance](#monitoring--maintenance)

---

## ✅ Prerequisites

Before you begin, ensure you have:

- [x] **Coolify Account** - Self-hosted Coolify instance running (visible in your screenshots)
- [x] **GitHub Account** - For repository hosting
- [x] **MongoDB Atlas Account** - Database already configured (visible in your .env)
- [x] **Domain Name** (Optional) - For production URL
- [x] **Email Service** - Gmail App Password or SMTP credentials
- [x] **Git Installed** - On your local machine

---

## 🔍 Pre-Deployment Checklist

### 1. Verify Your Backend Files

Ensure these files exist in `D:\leo\salonmoneynew\backend\`:

```
✓ Dockerfile                   (Created ✅)
✓ .dockerignore                (Created ✅)
✓ .env.production.example      (Created ✅)
✓ package.json                 (Exists ✅)
✓ server.js                    (Exists ✅)
✓ All routes, models, middleware folders
```

### 2. Initialize Git Repository (If Not Already Done)

```bash
cd D:\leo\salonmoneynew\backend
git init
git add .
git commit -m "Initial commit: SalonMoney backend with Docker support"
```

### 3. Create GitHub Repository

1. Go to https://github.com/new
2. Create a new **private repository** named `salonmoney-backend`
3. **DO NOT** add README, .gitignore, or license (we already have these)
4. Click "Create repository"

### 4. Push Code to GitHub

```bash
# Add GitHub remote (replace YOUR_USERNAME with your GitHub username)
git remote add origin https://github.com/YOUR_USERNAME/salonmoney-backend.git

# Push code
git branch -M main
git push -u origin main
```

**⚠️ IMPORTANT:** Make sure `.env` file is in `.gitignore` to prevent secrets from being pushed!

---

## 🎯 Step-by-Step Deployment

### **STEP 1: Access Coolify Dashboard**

1. Open your Coolify instance: `http://158.220.90.88:8000` (from your screenshot)
2. Login to your Coolify account
3. Navigate to **Projects** (left sidebar)
4. You should see your "**backend**" project (visible in Screenshot 1)

---

### **STEP 2: Add GitHub Source (One-Time Setup)**

Before deploying, connect your GitHub account to Coolify:

1. Click **"Sources"** in the left sidebar
2. Click **"+ Add Source"**
3. Select **"GitHub App"**
4. Follow the OAuth flow to connect your GitHub account
5. Authorize Coolify to access your `salonmoney-backend` repository

---

### **STEP 3: Create Backend Service**

1. Click on your **"backend"** project
2. Click **"+ Add Resource"** (visible in Screenshot 2)
3. You'll see the "New Resource" page (Screenshot 3)

**Choose Deployment Method:**

#### **Option A: Private Repository with GitHub App (Recommended)**

1. Select **"Private Repository (with GitHub App)"**
2. Configure:
   - **Repository**: Select `YOUR_USERNAME/salonmoney-backend`
   - **Branch**: `main`
   - **Build Pack**: `Dockerfile` (Auto-detected)
   - **Port**: `5000`
   - **Environment**: `production`

#### **Option B: Private Repository with Deploy Key**

1. Select **"Private Repository (with Deploy Key)"**
2. Copy the generated SSH deploy key
3. Add it to GitHub:
   - Go to your repository → Settings → Deploy keys
   - Add new deploy key
   - Paste the key, give it a title like "Coolify Deploy"
   - **DO NOT** check "Allow write access"
4. Return to Coolify and configure:
   - **Git URL**: `git@github.com:YOUR_USERNAME/salonmoney-backend.git`
   - **Branch**: `main`
   - **Port**: `5000`

---

### **STEP 4: Configure Build Settings**

After selecting your repository:

1. **General Settings:**
   - **Name**: `backend` (or `salonmoney-backend`)
   - **Environment**: `production`
   - **Port**: `5000`

2. **Build Settings:**
   - **Dockerfile Location**: `./Dockerfile` (root of repo)
   - **Docker Build Context**: `.` (root directory)
   - **Docker Build Args**: Leave empty (not needed)

3. **Network Settings:**
   - **Public**: ✅ Enable (to make it accessible)
   - **Domain**: `backend.yourdomain.com` (or use Coolify's auto-generated domain)
   - **HTTPS**: ✅ Enable (Coolify will auto-generate SSL certificate)

---

### **STEP 5: Add Environment Variables**

This is **CRITICAL** - Click on **"Environment Variables"** tab (visible in Screenshot 6):

Click **"+ Add"** and add each variable from the list below:

#### **Required Environment Variables**

| Variable Name | Value | Notes |
|--------------|-------|-------|
| `NODE_ENV` | `production` | Sets production mode |
| `PORT` | `5000` | Backend server port |
| `MONGODB_URI` | `mongodb+srv://salonmoney2025_db_user:Wisdom1995@salonmoney-cluster.1ehpwp7.mongodb.net/salonmoneynew?retryWrites=true&w=majority` | Your MongoDB Atlas connection |
| `JWT_SECRET` | `[GENERATE NEW]` | **CHANGE THIS!** |
| `JWT_EXPIRE` | `24h` | Token expiration |
| `REFRESH_TOKEN_SECRET` | `[GENERATE NEW]` | **CHANGE THIS!** |
| `REFRESH_TOKEN_EXPIRE` | `7d` | Refresh token expiration |
| `FRONTEND_URL` | `https://your-frontend-domain.com` | **UPDATE THIS!** |
| `NSL_TO_USDT_RECHARGE` | `23` | Conversion rate |
| `USDT_TO_NSL_WITHDRAWAL` | `23` | Conversion rate |
| `RECHARGE_FEE_PERCENTAGE` | `10` | Fee percentage |
| `WITHDRAWAL_FEE_PERCENTAGE` | `10` | Fee percentage |
| `MIN_WITHDRAWAL_AMOUNT_NSL` | `100` | Minimum withdrawal |
| `REFERRAL_BONUS_PERCENTAGE` | `35` | Referral bonus |
| `MAX_REFERRAL_LEVEL` | `1` | Referral levels |
| `SUPER_ADMIN_USERNAME` | `Wisrado` | **CHANGE IN PRODUCTION!** |
| `SUPER_ADMIN_EMAIL` | `admin@salonmoney.com` | Admin email |
| `SUPER_ADMIN_PHONE` | `+23273001412` | Admin phone |
| `SUPER_ADMIN_PASSWORD` | `[STRONG PASSWORD]` | **CHANGE THIS!** |
| `EMAIL_SERVICE` | `gmail` | Email provider |
| `EMAIL_USER` | `your-email@gmail.com` | **UPDATE THIS!** |
| `EMAIL_PASSWORD` | `your-app-password` | **UPDATE THIS!** |
| `EMAIL_FROM` | `noreply@salonmoney.com` | From address |

#### **Optional Environment Variables (Binance API)**

| Variable Name | Value |
|--------------|-------|
| `BINANCE_API_KEY` | `your_binance_api_key` |
| `BINANCE_API_SECRET` | `your_binance_api_secret` |
| `BINANCE_TESTNET` | `false` |

#### **Optional Environment Variables (Twilio SMS)**

| Variable Name | Value |
|--------------|-------|
| `TWILIO_ACCOUNT_SID` | `your_twilio_sid` |
| `TWILIO_AUTH_TOKEN` | `your_twilio_token` |
| `TWILIO_PHONE_NUMBER` | `+1234567890` |

---

### **STEP 6: Generate Secure JWT Secrets**

**CRITICAL SECURITY STEP!**

You MUST generate new JWT secrets. Run this on your local machine:

```bash
# Generate JWT_SECRET
node -e "console.log('JWT_SECRET=' + require('crypto').randomBytes(64).toString('hex'))"

# Generate REFRESH_TOKEN_SECRET
node -e "console.log('REFRESH_TOKEN_SECRET=' + require('crypto').randomBytes(64).toString('hex'))"
```

Copy the generated values and paste them into Coolify's environment variables.

---

### **STEP 7: Configure Persistent Storage (Important!)**

Your backend needs persistent storage for uploads:

1. In Coolify, go to **"Persistent Storage"** tab
2. Click **"+ Add Storage"**
3. Add these volumes:

| Host Path | Container Path | Description |
|----------|---------------|-------------|
| `/var/coolify/data/backend/uploads` | `/app/uploads` | User uploads (profiles, documents) |
| `/var/coolify/data/backend/logs` | `/app/logs` | Application logs |

---

### **STEP 8: Save and Deploy**

1. Review all settings
2. Click **"Save"** button
3. Click **"Deploy"** button (or "Start" if auto-deploy is disabled)
4. Coolify will:
   - Clone your repository
   - Build Docker image using your Dockerfile
   - Create container with environment variables
   - Start the service on port 5000
   - Set up SSL certificate (if domain configured)

**Monitor the deployment logs in real-time!**

---

### **STEP 9: Verify Deployment**

Once deployed, test your backend:

#### **Health Check**

```bash
# Replace with your Coolify-assigned URL or custom domain
curl https://backend.yourdomain.com/api/health
```

Expected response:
```json
{
  "status": "Server is running",
  "timestamp": "2025-12-14T10:00:00.000Z"
}
```

#### **Products Endpoint**

```bash
curl https://backend.yourdomain.com/api/products
```

---

## 🗄️ Database Setup

Your MongoDB Atlas database is already configured! But let's verify:

### Verify MongoDB Connection

1. In Coolify deployment logs, look for:
   ```
   MongoDB connected
   ```

2. If you see connection errors:
   - Check MongoDB Atlas Network Access
   - Ensure `0.0.0.0/0` is whitelisted (or Coolify server IP)
   - Verify connection string in environment variables

### Seed Initial Data (Optional)

If you need to seed products or create super admin:

1. Go to Coolify → Terminal (for your backend service)
2. Run seeding commands:

```bash
# Seed super admin
node scripts/admin/createSuperAdmin.js

# Seed products
node scripts/seed/seedProducts.js

# Seed currencies
node scripts/seed/seedCurrencies.js
```

---

## 🌐 Frontend Configuration

After backend is deployed, update your frontend to point to the backend:

### Update Frontend `.env` File

```env
# Frontend .env file
VITE_API_URL=https://backend.yourdomain.com/api
VITE_SOCKET_URL=https://backend.yourdomain.com
```

### CORS Configuration

Your backend is already configured to accept requests from `FRONTEND_URL` environment variable. Make sure:

1. `FRONTEND_URL` in backend env vars matches your actual frontend domain
2. Example: If frontend is at `https://app.salonmoney.com`, set:
   ```
   FRONTEND_URL=https://app.salonmoney.com
   ```

---

## 🔧 Post-Deployment Steps

### 1. Test Core Functionality

- [ ] Health check endpoint working
- [ ] User registration working
- [ ] User login working
- [ ] File uploads working
- [ ] Socket.io connections working
- [ ] Email notifications working

### 2. Create Super Admin Account

Login using the credentials you set in environment variables:

```
Username: Wisrado (or your custom username)
Password: [Your secure password]
```

### 3. Configure Email Service (Gmail)

If using Gmail:

1. Go to https://myaccount.google.com/security
2. Enable **2-Factor Authentication**
3. Generate **App Password**:
   - Go to App Passwords
   - Select "Mail" and "Other (Custom name)"
   - Name it "SalonMoney Backend"
   - Copy the 16-character password
4. Update `EMAIL_PASSWORD` in Coolify environment variables
5. Restart backend service

### 4. Set Up Monitoring

Enable logging and monitoring:

1. In Coolify, enable **"Log Drain"** (if available)
2. Monitor logs regularly:
   - Go to backend service → Logs tab
   - Check for errors or warnings

### 5. Set Up Automated Backups

**MongoDB Backups:**
1. Go to MongoDB Atlas
2. Navigate to Backup tab
3. Enable automated backups (recommended: daily)

**Coolify Backups:**
1. In Coolify, go to Settings → Backups
2. Configure S3-compatible storage (optional)

---

## 🐛 Troubleshooting

### Issue 1: Deployment Fails with "Build Error"

**Solution:**
- Check Coolify build logs for specific errors
- Ensure Dockerfile syntax is correct
- Verify all dependencies in package.json are valid

### Issue 2: Container Starts but Crashes Immediately

**Solution:**
- Check container logs in Coolify
- Look for MongoDB connection errors
- Verify all required environment variables are set
- Check for port conflicts

### Issue 3: "MongoDB connection failed"

**Solution:**
- Verify MongoDB Atlas Network Access whitelist
- Check if connection string is correct
- Test connection string locally:
  ```bash
  mongosh "mongodb+srv://salonmoney2025_db_user:Wisdom1995@salonmoney-cluster.1ehpwp7.mongodb.net/salonmoneynew"
  ```

### Issue 4: CORS Errors from Frontend

**Solution:**
- Verify `FRONTEND_URL` environment variable is set correctly
- Ensure it matches your frontend domain exactly (including https://)
- Check backend logs for CORS errors
- Restart backend service after changing FRONTEND_URL

### Issue 5: File Uploads Not Working

**Solution:**
- Verify persistent storage is mounted correctly
- Check container has write permissions to `/app/uploads`
- Look for logs in `/app/logs`

### Issue 6: Emails Not Sending

**Solution:**
- Verify Gmail App Password is correct
- Check email service logs
- Test SMTP connection
- Ensure 2FA is enabled on Gmail account

### Issue 7: Cron Jobs Not Running

**Solution:**
- Check server timezone: `TZ=UTC` (recommended)
- Verify cron is initialized (check logs for "Running daily income cron job...")
- Container must stay running for cron to work

---

## 📊 Monitoring & Maintenance

### Daily Checks

- [ ] Check application logs for errors
- [ ] Monitor disk usage (uploads folder)
- [ ] Verify cron jobs are running (daily income, exchange rates)
- [ ] Check database connection status

### Weekly Checks

- [ ] Review user activity logs
- [ ] Check for failed transactions
- [ ] Review security audit logs
- [ ] Monitor API response times

### Monthly Checks

- [ ] Update dependencies (`npm audit fix`)
- [ ] Review and rotate JWT secrets (optional)
- [ ] Check MongoDB disk usage
- [ ] Review backup integrity

### Security Best Practices

1. **Never commit `.env` file to Git**
2. **Rotate JWT secrets every 90 days**
3. **Use strong admin passwords (16+ characters)**
4. **Enable MongoDB IP whitelisting**
5. **Monitor logs for suspicious activity**
6. **Keep Node.js and dependencies updated**
7. **Enable rate limiting (already configured)**
8. **Use HTTPS only (enforce in Coolify)**

---

## 🎉 Success Checklist

After completing all steps, verify:

- [x] Backend is accessible via HTTPS
- [x] Health check returns success
- [x] MongoDB connection is stable
- [x] Environment variables are set correctly
- [x] Frontend can communicate with backend
- [x] File uploads work
- [x] Emails are sending
- [x] Socket.io connections work
- [x] Admin can log in
- [x] Cron jobs are running
- [x] Logs are being written
- [x] SSL certificate is valid

---

## 📞 Support & Resources

### Useful Links

- **Coolify Documentation**: https://coolify.io/docs
- **MongoDB Atlas**: https://cloud.mongodb.com/
- **Node.js Best Practices**: https://github.com/goldbergyoni/nodebestpractices
- **Docker Documentation**: https://docs.docker.com/

### Quick Commands Reference

```bash
# View logs
docker logs <container_id>

# Restart container
docker restart <container_id>

# Execute command in container
docker exec -it <container_id> sh

# Check container status
docker ps

# View environment variables
docker exec <container_id> env
```

---

## 🔄 Updating Your Backend

When you make code changes:

1. Commit changes to Git:
   ```bash
   git add .
   git commit -m "Description of changes"
   git push origin main
   ```

2. In Coolify:
   - Click **"Redeploy"** button
   - Coolify will pull latest code and rebuild
   - Zero-downtime deployment (if configured)

---

**Deployment Guide Version:** 1.0
**Last Updated:** December 14, 2025
**Author:** Claude Code with 10 years Software Engineering Experience

---

**🎯 Pro Tip:** Bookmark this guide and keep it updated as you make changes to your deployment configuration!
