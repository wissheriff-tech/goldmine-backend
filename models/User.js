const { DataTypes } = require('sequelize');
const bcrypt = require('bcryptjs');
const { sequelize } = require('../config/database');

const User = sequelize.define('User', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  username: {
    type: DataTypes.STRING(50),
    allowNull: false,
    unique: true,
    set(val) {
      this.setDataValue('username', val ? val.trim().toLowerCase() : val);
    }
  },
  phone: {
    type: DataTypes.STRING(50),
    allowNull: false,
    unique: true,
    set(val) {
      this.setDataValue('phone', val ? val.trim() : val);
    }
  },
  password_hash: {
    type: DataTypes.STRING,
    allowNull: false
  },
  role: {
    type: DataTypes.ENUM('user', 'admin', 'superadmin', 'finance', 'verificator', 'approval', 'ambassador'),
    defaultValue: 'user'
  },
  ambassador_region: {
    type: DataTypes.STRING(100),
    allowNull: true,
    defaultValue: null
  },
  ambassador_sector: {
    type: DataTypes.STRING(100),
    allowNull: true,
    defaultValue: null
  },
  referral_code: {
    type: DataTypes.STRING(50),
    unique: true,
    allowNull: true
  },
  referred_by: {
    type: DataTypes.STRING(50),
    allowNull: true,
    defaultValue: null
  },
  balance_NSL: {
    type: DataTypes.DECIMAL(18, 4),
    defaultValue: 0,
    get() {
      const val = this.getDataValue('balance_NSL');
      return val === null ? 0 : parseFloat(val);
    }
  },
  balance_usdt: {
    type: DataTypes.DECIMAL(18, 4),
    defaultValue: 0,
    get() {
      const val = this.getDataValue('balance_usdt');
      return val === null ? 0 : parseFloat(val);
    }
  },
  vip_level: {
    type: DataTypes.ENUM('VIP0', 'VIP1', 'VIP2', 'VIP3', 'VIP4', 'VIP5', 'VIP6', 'VIP7', 'VIP8', 'VIP9', 'none'),
    defaultValue: 'none'
  },
  status: {
    type: DataTypes.ENUM('active', 'frozen', 'pending'),
    defaultValue: 'pending'
  },
  kyc_verified: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  kyc_id_front: {
    type: DataTypes.STRING(500),
    allowNull: true
  },
  kyc_id_back: {
    type: DataTypes.STRING(500),
    allowNull: true
  },
  kyc_selfie: {
    type: DataTypes.STRING(500),
    allowNull: true
  },
  kyc_additional: {
    type: DataTypes.STRING(500),
    allowNull: true
  },
  email: {
    type: DataTypes.STRING(255),
    unique: true,
    allowNull: true,
    set(val) {
      this.setDataValue('email', val ? val.trim().toLowerCase() : val);
    }
  },
  resetPasswordToken: {
    type: DataTypes.STRING,
    allowNull: true
  },
  resetPasswordExpires: {
    type: DataTypes.DATE,
    allowNull: true
  },
  twoFactorEnabled: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  twoFactorCode: {
    type: DataTypes.STRING(72),
    allowNull: true
  },
  twoFactorExpires: {
    type: DataTypes.DATE,
    allowNull: true
  },
  emailVerified: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  emailVerificationToken: {
    type: DataTypes.STRING,
    allowNull: true
  },
  emailVerificationExpires: {
    type: DataTypes.DATE,
    allowNull: true
  },
  preferred_currency: {
    type: DataTypes.STRING(10),
    defaultValue: 'USD'
  },
  last_login: {
    type: DataTypes.DATE,
    allowNull: true,
    defaultValue: null
  },
  failed_login_attempts: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  },
  locked_until: {
    type: DataTypes.DATE,
    allowNull: true,
    defaultValue: null
  }
}, {
  tableName: 'users',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  defaultScope: {
    attributes: {
      exclude: ['resetPasswordToken', 'resetPasswordExpires', 'twoFactorCode', 'twoFactorExpires', 'emailVerificationToken', 'emailVerificationExpires']
    }
  },
  scopes: {
    withSecrets: {
      attributes: {}
    }
  }
});

// Hash password before create/update
User.beforeCreate(async (user) => {
  if (user.password_hash) {
    const salt = await bcrypt.genSalt(10);
    user.password_hash = await bcrypt.hash(user.password_hash, salt);
  }
});

User.beforeUpdate(async (user) => {
  if (user.changed('password_hash')) {
    const salt = await bcrypt.genSalt(10);
    user.password_hash = await bcrypt.hash(user.password_hash, salt);
  }
});

// Instance methods
User.prototype.comparePassword = async function (inputPassword) {
  return await bcrypt.compare(inputPassword, this.password_hash);
};

User.prototype.generateReferralCode = function () {
  return Math.random().toString(36).substring(2, 12).toUpperCase();
};

module.exports = User;
