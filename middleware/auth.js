const User = require('../models/User');
const Session = require('../models/Session');
const logger = require('../utils/logger');

const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    const token = authHeader.split(' ')[1];

    const session = await Session.findOne({
      where: { access_token: token, is_active: true }
    });

    if (!session || new Date() > session.expires_at) {
      if (session && new Date() > session.expires_at) {
        await session.update({ is_active: false });
      }
      return res.status(401).json({ message: 'Invalid or expired token' });
    }

    const user = await User.findByPk(session.user_id);
    if (!user) {
      return res.status(401).json({ message: 'User not found' });
    }

    await session.update({ last_activity: new Date() });

    req.user = {
      id: user.id,
      username: user.username,
      phone: user.phone,
      role: user.role
    };
    next();
  } catch (error) {
    logger.error('Authentication error:', error.message);
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
};

const authorize = (roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Access denied' });
    }
    next();
  };
};

const authorizeRoles = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Access denied' });
    }
    next();
  };
};

module.exports = { authenticate, authorize, authorizeRoles };
