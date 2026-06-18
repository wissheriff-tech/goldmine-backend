/**
 * Model Registry & Associations
 * Central file for all Sequelize models and their relationships
 */

const { sequelize } = require('../config/database');

// Import all models
const User = require('./User');
const Product = require('./Product');
const UserProduct = require('./UserProduct');
const WithdrawalAddress = require('./WithdrawalAddress');
const Transaction = require('./Transaction');
const Session = require('./Session');
const Chat = require('./Chat');
const ChatMessage = require('./ChatMessage');
const Notification = require('./Notification');
const Referral = require('./Referral');
const TwoFactorAuth = require('./TwoFactorAuth');
const DepositProof = require('./DepositProof');
const PaymentSetting = require('./PaymentSetting');
const Testimonial = require('./Testimonial');

// ==================== ASSOCIATIONS ====================

// User <-> UserProduct <-> Product
User.hasMany(UserProduct, { foreignKey: 'user_id', as: 'products' });
UserProduct.belongsTo(User, { foreignKey: 'user_id', as: 'user' });
UserProduct.belongsTo(Product, { foreignKey: 'product_id', as: 'product' });
Product.hasMany(UserProduct, { foreignKey: 'product_id', as: 'userProducts' });

// User <-> WithdrawalAddress
User.hasMany(WithdrawalAddress, { foreignKey: 'user_id', as: 'withdrawal_addresses' });
WithdrawalAddress.belongsTo(User, { foreignKey: 'user_id', as: 'user' });
WithdrawalAddress.belongsTo(User, { foreignKey: 'verified_by', as: 'verifier' });

// User <-> Transaction
User.hasMany(Transaction, { foreignKey: 'user_id', as: 'transactions' });
Transaction.belongsTo(User, { foreignKey: 'user_id', as: 'user' });
Transaction.belongsTo(User, { foreignKey: 'approved_by', as: 'approver' });
Transaction.belongsTo(Product, { foreignKey: 'product_id', as: 'product' });

// User <-> Session
User.hasMany(Session, { foreignKey: 'user_id', as: 'sessions' });
Session.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

// User <-> Chat <-> ChatMessage
User.hasMany(Chat, { foreignKey: 'user_id', as: 'chats' });
Chat.belongsTo(User, { foreignKey: 'user_id', as: 'user' });
Chat.belongsTo(User, { foreignKey: 'admin_id', as: 'admin' });
Chat.hasMany(ChatMessage, { foreignKey: 'chat_id', as: 'messages' });
ChatMessage.belongsTo(Chat, { foreignKey: 'chat_id', as: 'chat' });
ChatMessage.belongsTo(User, { foreignKey: 'sender_id', as: 'sender' });

// User <-> Notification
User.hasMany(Notification, { foreignKey: 'user_id', as: 'notifications' });
Notification.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

// User <-> Referral
User.hasMany(Referral, { foreignKey: 'referrer_id', as: 'referrals_given' });
User.hasMany(Referral, { foreignKey: 'referred_id', as: 'referrals_received' });
Referral.belongsTo(User, { foreignKey: 'referrer_id', as: 'referrer' });
Referral.belongsTo(User, { foreignKey: 'referred_id', as: 'referred' });

// User <-> TwoFactorAuth
User.hasOne(TwoFactorAuth, { foreignKey: 'user_id', as: 'twoFactorAuth' });
TwoFactorAuth.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

// User <-> DepositProof
User.hasMany(DepositProof, { foreignKey: 'user_id', as: 'depositProofs' });
DepositProof.belongsTo(User, { foreignKey: 'user_id', as: 'user' });
DepositProof.belongsTo(User, { foreignKey: 'reviewed_by', as: 'reviewer' });
DepositProof.belongsTo(Transaction, { foreignKey: 'transaction_id', as: 'transaction' });

module.exports = {
  sequelize,
  User,
  Product,
  UserProduct,
  WithdrawalAddress,
  Transaction,
  Session,
  Chat,
  ChatMessage,
  Notification,
  Referral,
  TwoFactorAuth,
  DepositProof,
  PaymentSetting,
  Testimonial,
};
