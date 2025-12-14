# ⚡ Quick Start - Coolify Deployment

**Fast deployment reference for experienced developers**

---

## 🚀 30-Second Deployment

### 1. Push to GitHub
```bash
cd D:\leo\salonmoneynew\backend
git init
git add .
git commit -m "Initial commit with Docker support"
git remote add origin https://github.com/YOUR_USERNAME/salonmoney-backend.git
git push -u origin main
```

### 2. Coolify Setup
1. Go to Coolify → Projects → **backend** → **+ Add Resource**
2. Select: **Private Repository (with GitHub App)**
3. Choose: `YOUR_USERNAME/salonmoney-backend`
4. Branch: `main`
5. Port: `5000`
6. Environment: `production`

### 3. Environment Variables (Copy-Paste Ready)

```bash
NODE_ENV=production
PORT=5000
MONGODB_URI=mongodb+srv://salonmoney2025_db_user:Wisdom1995@salonmoney-cluster.1ehpwp7.mongodb.net/salonmoneynew?retryWrites=true&w=majority
JWT_SECRET=[GENERATE_NEW]
JWT_EXPIRE=24h
REFRESH_TOKEN_SECRET=[GENERATE_NEW]
REFRESH_TOKEN_EXPIRE=7d
FRONTEND_URL=https://your-frontend-domain.com
NSL_TO_USDT_RECHARGE=23
USDT_TO_NSL_WITHDRAWAL=23
RECHARGE_FEE_PERCENTAGE=10
WITHDRAWAL_FEE_PERCENTAGE=10
MIN_WITHDRAWAL_AMOUNT_NSL=100
REFERRAL_BONUS_PERCENTAGE=35
MAX_REFERRAL_LEVEL=1
SUPER_ADMIN_USERNAME=Wisrado
SUPER_ADMIN_EMAIL=admin@salonmoney.com
SUPER_ADMIN_PHONE=+23273001412
SUPER_ADMIN_PASSWORD=[CHANGE_THIS]
EMAIL_SERVICE=gmail
EMAIL_USER=[YOUR_GMAIL]
EMAIL_PASSWORD=[APP_PASSWORD]
EMAIL_FROM=noreply@salonmoney.com
```

### 4. Generate JWT Secrets
```bash
node -e "console.log('JWT_SECRET=' + require('crypto').randomBytes(64).toString('hex'))"
node -e "console.log('REFRESH_TOKEN_SECRET=' + require('crypto').randomBytes(64).toString('hex'))"
```

### 5. Add Persistent Storage
- `/var/coolify/data/backend/uploads` → `/app/uploads`
- `/var/coolify/data/backend/logs` → `/app/logs`

### 6. Deploy
Click **Deploy** in Coolify!

### 7. Verify
```bash
curl https://your-backend-url.com/api/health
```

---

## ⚙️ Critical Updates Needed

Before deploying, **MUST CHANGE**:

1. ✅ `JWT_SECRET` - Generate new (see step 4)
2. ✅ `REFRESH_TOKEN_SECRET` - Generate new (see step 4)
3. ✅ `FRONTEND_URL` - Your actual frontend URL
4. ✅ `SUPER_ADMIN_PASSWORD` - Strong password
5. ✅ `EMAIL_USER` - Your Gmail address
6. ✅ `EMAIL_PASSWORD` - Gmail App Password

---

## 🎯 Post-Deployment

1. Test health: `/api/health`
2. Test products: `/api/products`
3. Login as admin
4. Verify email sending works
5. Test file uploads
6. Check Socket.io connection

---

## 📊 Files Created

- ✅ `Dockerfile` - Production-optimized Docker image
- ✅ `.dockerignore` - Excludes unnecessary files
- ✅ `.env.production.example` - Environment template
- ✅ `COOLIFY_DEPLOYMENT_GUIDE.md` - Full guide (read this!)
- ✅ `QUICK_START.md` - This file

---

## 🐛 Quick Troubleshooting

| Issue | Solution |
|-------|----------|
| Build fails | Check Dockerfile syntax, verify package.json |
| Container crashes | Check env vars, MongoDB connection |
| CORS errors | Update `FRONTEND_URL` to match frontend domain |
| Emails not sending | Generate Gmail App Password, enable 2FA |
| Uploads fail | Check persistent storage mount |

---

**📖 Full Guide:** See `COOLIFY_DEPLOYMENT_GUIDE.md` for detailed instructions

**🎉 Done!** Your backend should be running at `https://your-domain.com`
