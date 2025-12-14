# 🍃 MongoDB Setup in Coolify - Step by Step Guide

**Follow these exact steps to set up MongoDB in Coolify instead of using MongoDB Atlas**

---

## ✅ Step-by-Step Instructions

### **STEP 1: Add MongoDB Database Resource**

1. **Open your browser** and go to your Coolify instance:
   ```
   http://158.220.90.88:8000
   ```

2. **Login** to Coolify

3. **Navigate to your project:**
   - Click **"Projects"** in the left sidebar
   - Click on your **"backend"** project

4. **Add MongoDB resource:**
   - Click the **"+ Add Resource"** button (top right)
   - You'll see the "New Resource" page with options

5. **Scroll down** to the **"Databases"** section
   - You'll see tiles for: PostgreSQL, MySQL, MariaDB, MongoDB, Redis, etc.

6. **Click on "MongoDB"** tile

---

### **STEP 2: Configure MongoDB**

You'll see a configuration form. Fill it in:

#### **General Settings:**
```
Name: salonmoney-mongodb
Environment: production
```

#### **MongoDB Settings:**
```
MongoDB Version: 7.0
Root Username: admin
Root Password: [Let Coolify auto-generate]
             OR create your own strong password
Database Name: salonmoneynew
```

#### **Storage Settings:**
```
☑ Enable Persistent Storage
Storage Path: /data/db (default - don't change)
```

#### **Network Settings:**
```
☐ Make it publicly available (UNCHECK - keep it private)
Port: 27017 (default - don't change)
```

#### **Advanced (Optional):**
```
Leave all advanced settings as default
```

7. **Click "Create" or "Save"** button

8. **Wait for MongoDB to start**
   - Coolify will pull the MongoDB Docker image
   - This takes 1-2 minutes
   - Watch the status change to "Running"

---

### **STEP 3: Get MongoDB Connection Details**

After MongoDB is created and running:

1. **Click on your MongoDB resource** (salonmoney-mongodb)

2. **Find the Connection String** section
   - Coolify displays the internal connection string
   - Look for something like:
   ```
   Internal URL: mongodb://admin:x9kL2mP4nQ@salonmoney-mongodb:27017
   ```

3. **Copy the full connection string**

   It should look like:
   ```
   mongodb://admin:YOUR_PASSWORD@salonmoney-mongodb:27017
   ```

4. **Add your database name to the end:**
   ```
   mongodb://admin:YOUR_PASSWORD@salonmoney-mongodb:27017/salonmoneynew?authSource=admin
   ```

   **Example (your actual password will be different):**
   ```
   mongodb://admin:K8mP2nQ5rT9vW3x@salonmoney-mongodb:27017/salonmoneynew?authSource=admin
   ```

5. **Save this connection string** - you'll need it in the next step!

---

### **STEP 4: Update Backend Environment Variables**

1. **Go back to Projects** → Click on your **backend** service (not the MongoDB)

2. **Click on "Configuration"** tab (or "Settings")

3. **Click on "Environment Variables"** section

4. **Find the MONGODB_URI variable:**
   - Scroll through your environment variables
   - Look for `MONGODB_URI`

5. **Edit MONGODB_URI:**

   **OLD VALUE (Atlas - causing errors):**
   ```
   mongodb+srv://salonmoney2025_db_user:Wisdom1995@salonmoney-cluster.1ehpwp7.mongodb.net/salonmoneynew?retryWrites=true&w=majority
   ```

   **NEW VALUE (Coolify MongoDB):**
   ```
   mongodb://admin:YOUR_PASSWORD@salonmoney-mongodb:27017/salonmoneynew?authSource=admin
   ```

6. **Click "Save"** or "Update"

---

### **STEP 5: Restart Backend Service**

1. **Still in your backend service**, find the **"Restart"** button
   - Usually at the top right or in the Actions menu

2. **Click "Restart"**
   - Coolify will restart your backend container
   - This takes 10-30 seconds

3. **Watch the logs** (click "Logs" tab)
   - You should see the backend starting up
   - Look for these messages:

   ```
   ✅ MongoDB connected
   ✅ Socket.io initialized
   ✅ Server running on port 5000
   ```

4. **If you see "MongoDB connected"** - SUCCESS! 🎉

---

### **STEP 6: Verify Connection**

1. **Test the health endpoint:**

   Open a new browser tab and go to:
   ```
   https://your-backend-domain.com/api/health
   ```

   **You should see:**
   ```json
   {
     "status": "Server is running",
     "timestamp": "2025-12-14T..."
   }
   ```

2. **Check MongoDB connection in logs:**
   - In Coolify, go to backend → Logs
   - Look for: `MongoDB connected`
   - Should NOT see: `MongoDB connection error`

---

### **STEP 7: Seed Initial Data (Important!)**

Since you're starting with a fresh MongoDB, you need to add initial data:

1. **Go to backend service** in Coolify

2. **Click "Terminal"** or "Console" tab
   - This opens a shell inside your backend container

3. **Run seed commands:**

   ```bash
   # Create super admin
   node scripts/admin/createSuperAdmin.js

   # Seed VIP products
   node scripts/seed/seedProducts.js

   # Seed currencies (optional)
   node scripts/seed/seedCurrencies.js
   ```

4. **Verify it worked:**
   ```bash
   # Check if products were created
   curl http://localhost:5000/api/products
   ```

   You should see 8 VIP products!

---

## 🎯 Quick Reference

### **MongoDB Connection String Format:**
```
mongodb://[username]:[password]@[container-name]:27017/[database]?authSource=admin
```

### **Your Actual Values:**
```
Username: admin
Password: [From Coolify - auto-generated]
Container: salonmoney-mongodb
Port: 27017
Database: salonmoneynew
```

### **Complete Connection String Example:**
```
mongodb://admin:K8mP2nQ5rT9vW3x@salonmoney-mongodb:27017/salonmoneynew?authSource=admin
```

---

## ✅ Success Checklist

After completing all steps, verify:

- [ ] MongoDB container is running in Coolify
- [ ] Backend environment variable updated with new connection string
- [ ] Backend restarted successfully
- [ ] Backend logs show "MongoDB connected"
- [ ] Health endpoint returns success
- [ ] Super admin created
- [ ] Products seeded (8 VIP products)
- [ ] No connection errors in logs

---

## 🐛 Troubleshooting

### Problem: "MongoDB connection failed"

**Check:**
1. MongoDB container is running (green status in Coolify)
2. Connection string is correct (no typos)
3. Password matches the one Coolify generated
4. Container name is exact: `salonmoney-mongodb`

**Fix:**
- Go to MongoDB resource in Coolify
- Check the "Internal URL" - copy it exactly
- Make sure to add `/salonmoneynew?authSource=admin` at the end

---

### Problem: "Authentication failed"

**Check:**
- Username is `admin`
- Password matches Coolify's generated password
- Connection string ends with `?authSource=admin`

**Fix:**
```
mongodb://admin:EXACT_PASSWORD@salonmoney-mongodb:27017/salonmoneynew?authSource=admin
```

---

### Problem: "Cannot connect to host"

**Check:**
- Both MongoDB and Backend are in the same project
- Container name is correct

**Fix:**
- In Coolify, verify MongoDB container name
- Make sure it's `salonmoney-mongodb` (or whatever you named it)

---

### Problem: Backend won't restart

**Check Logs:**
- Click on backend → Logs
- Look for specific error messages

**Common Fixes:**
- Check all environment variables are set
- Verify no syntax errors in connection string
- Make sure MongoDB is running first

---

## 🔄 Comparison: Atlas vs Coolify

| Feature | MongoDB Atlas (Old) | MongoDB Coolify (New) |
|---------|-------------------|---------------------|
| Connection | ❌ Internet required | ✅ Local Docker network |
| Speed | ⚠️ Network latency | ✅ Ultra-fast local |
| IP Whitelist | ❌ Required | ✅ Not needed |
| Setup | ⚠️ Complex | ✅ Simple |
| Connection String | `mongodb+srv://...` | `mongodb://...` |
| Cost | ✅ Free tier | ✅ Free (your storage) |
| Backups | ✅ Automatic | ⚠️ Manual |
| Connection Errors | ❌ Common | ✅ Rare |

---

## 💾 Backup Your Data (Important!)

Since you're using local MongoDB, set up backups:

### **Option 1: Coolify Backups (Recommended)**

1. Go to MongoDB resource in Coolify
2. Click "Backups" tab
3. Configure backup schedule (daily recommended)
4. Set backup retention (keep 7 days)

### **Option 2: Manual Backups**

In Coolify terminal (MongoDB container):
```bash
# Backup
mongodump --uri="mongodb://admin:PASSWORD@localhost:27017/salonmoneynew?authSource=admin" --out=/backup

# Restore
mongorestore --uri="mongodb://admin:PASSWORD@localhost:27017/salonmoneynew?authSource=admin" /backup/salonmoneynew
```

---

## 📊 What Happens Next

After MongoDB is set up:

1. **Backend connects to local MongoDB** (no internet needed)
2. **Data is stored persistently** (survives container restarts)
3. **Frontend connects to backend API** (doesn't know about MongoDB)
4. **All CRUD operations work** (create, read, update, delete)

**Your Architecture:**
```
Frontend (Browser)
    ↓ HTTPS
Backend API (Node.js) ← You are here
    ↓ Internal Docker Network
MongoDB (Database) ← We just set this up
```

---

## 🎉 You're Done!

Once you see "MongoDB connected" in your backend logs, you're all set!

**Next steps:**
- Deploy your frontend
- Test user registration
- Test login
- Test VIP purchases

---

**Need help?** Check the troubleshooting section above or the main deployment guide.

**Created:** December 14, 2025
**For:** SalonMoney Backend MongoDB Setup
