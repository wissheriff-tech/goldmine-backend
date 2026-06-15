const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Testimonial = sequelize.define('Testimonial', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name:    { type: DataTypes.STRING(80), allowNull: false },
  country: { type: DataTypes.STRING(50), allowNull: false },
  flag:    { type: DataTypes.STRING(10), allowNull: false, defaultValue: '' },
  phone:   { type: DataTypes.STRING(30), allowNull: false },
  type:    { type: DataTypes.ENUM('withdrawal', 'deposit', 'earning'), allowNull: false },
  amount_nsl: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
  visible: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
}, {
  tableName: 'testimonials',
  timestamps: true,
});

module.exports = Testimonial;
