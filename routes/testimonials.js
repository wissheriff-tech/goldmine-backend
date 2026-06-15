const express = require('express');
const { Testimonial } = require('../models');
const { authenticate, authorize } = require('../middleware/auth');
const { adminLimiter } = require('../middleware/security');

const router = express.Router();

const SEED = [
  // Sierra Leone
  { name: 'Mohamed Bangura', country: 'Sierra Leone', flag: '🇸🇱', phone: '+232 76 234567', type: 'withdrawal', amount_nsl: 3200 },
  { name: 'Fatmata Kamara',  country: 'Sierra Leone', flag: '🇸🇱', phone: '+232 78 345678', type: 'earning',    amount_nsl: 480  },
  { name: 'Ibrahim Koroma',  country: 'Sierra Leone', flag: '🇸🇱', phone: '+232 77 456789', type: 'deposit',    amount_nsl: 1150 },
  { name: 'Aminata Sesay',   country: 'Sierra Leone', flag: '🇸🇱', phone: '+232 76 567890', type: 'withdrawal', amount_nsl: 2750 },
  { name: 'Abdul Conteh',    country: 'Sierra Leone', flag: '🇸🇱', phone: '+232 78 678901', type: 'earning',    amount_nsl: 620  },
  // Liberia
  { name: 'Emmanuel Kollie', country: 'Liberia', flag: '🇱🇷', phone: '+231 77 123456', type: 'withdrawal', amount_nsl: 4100 },
  { name: 'Comfort Toe',     country: 'Liberia', flag: '🇱🇷', phone: '+231 88 234567', type: 'earning',    amount_nsl: 390  },
  { name: 'Varney Konneh',   country: 'Liberia', flag: '🇱🇷', phone: '+231 77 345678', type: 'deposit',    amount_nsl: 2000 },
  { name: 'Nowai Flomo',     country: 'Liberia', flag: '🇱🇷', phone: '+231 88 456789', type: 'withdrawal', amount_nsl: 1800 },
  { name: 'Thomas Nimba',    country: 'Liberia', flag: '🇱🇷', phone: '+231 77 567890', type: 'earning',    amount_nsl: 550  },
  // Senegal
  { name: 'Moussa Diallo',   country: 'Senegal', flag: '🇸🇳', phone: '+221 77 123 456', type: 'withdrawal', amount_nsl: 5200 },
  { name: 'Aissatou Ndiaye', country: 'Senegal', flag: '🇸🇳', phone: '+221 78 234 567', type: 'earning',    amount_nsl: 720  },
  { name: 'Ibrahima Sow',    country: 'Senegal', flag: '🇸🇳', phone: '+221 76 345 678', type: 'deposit',    amount_nsl: 3000 },
  { name: 'Khady Fall',      country: 'Senegal', flag: '🇸🇳', phone: '+221 70 456 789', type: 'withdrawal', amount_nsl: 2400 },
  { name: 'Ousmane Badji',   country: 'Senegal', flag: '🇸🇳', phone: '+221 77 567 890', type: 'earning',    amount_nsl: 890  },
  // Togo
  { name: 'Kofi Mensah',     country: 'Togo', flag: '🇹🇬', phone: '+228 90 12 34 56', type: 'withdrawal', amount_nsl: 2900 },
  { name: 'Ama Abalo',       country: 'Togo', flag: '🇹🇬', phone: '+228 91 23 45 67', type: 'earning',    amount_nsl: 410  },
  { name: 'Edem Agbeko',     country: 'Togo', flag: '🇹🇬', phone: '+228 90 34 56 78', type: 'deposit',    amount_nsl: 1600 },
  { name: 'Akosua Dossou',   country: 'Togo', flag: '🇹🇬', phone: '+228 99 45 67 89', type: 'withdrawal', amount_nsl: 3500 },
  { name: 'Yao Kpakpo',      country: 'Togo', flag: '🇹🇬', phone: '+228 90 56 78 90', type: 'earning',    amount_nsl: 670  },
  // Nigeria
  { name: 'Chukwuemeka Obi',   country: 'Nigeria', flag: '🇳🇬', phone: '+234 803 123 4567', type: 'withdrawal', amount_nsl: 6800 },
  { name: 'Ngozi Okafor',      country: 'Nigeria', flag: '🇳🇬', phone: '+234 806 234 5678', type: 'earning',    amount_nsl: 940  },
  { name: 'Babatunde Adeyemi', country: 'Nigeria', flag: '🇳🇬', phone: '+234 815 345 6789', type: 'deposit',    amount_nsl: 4500 },
  { name: 'Chidinma Eze',      country: 'Nigeria', flag: '🇳🇬', phone: '+234 701 456 7890', type: 'withdrawal', amount_nsl: 3100 },
  { name: 'Emeka Nwosu',       country: 'Nigeria', flag: '🇳🇬', phone: '+234 810 567 8901', type: 'earning',    amount_nsl: 1200 },
];

// Seed on first boot if table is empty
async function seedIfEmpty() {
  try {
    await Testimonial.sync({ alter: false });
    const count = await Testimonial.count();
    if (count === 0) {
      await Testimonial.bulkCreate(SEED);
    }
  } catch {}
}
seedIfEmpty();

// Public: visible testimonials for user dashboard feed
router.get('/', async (req, res) => {
  try {
    const rows = await Testimonial.findAll({
      where: { visible: true },
      order: [['id', 'ASC']],
    });
    res.json({ testimonials: rows });
  } catch (err) {
    res.status(500).json({ message: 'Error fetching testimonials', error: err.message });
  }
});

// Admin: all testimonials
router.get('/all', authenticate, authorize(['superadmin']), async (req, res) => {
  try {
    const rows = await Testimonial.findAll({ order: [['id', 'ASC']] });
    res.json({ testimonials: rows });
  } catch (err) {
    res.status(500).json({ message: 'Error fetching testimonials', error: err.message });
  }
});

// Admin: toggle visible
router.patch('/:id/toggle', authenticate, authorize(['superadmin']), adminLimiter, async (req, res) => {
  try {
    const t = await Testimonial.findByPk(req.params.id);
    if (!t) return res.status(404).json({ message: 'Not found' });
    t.visible = !t.visible;
    await t.save();
    res.json({ testimonial: t });
  } catch (err) {
    res.status(500).json({ message: 'Error toggling testimonial', error: err.message });
  }
});

// Admin: delete
router.delete('/:id', authenticate, authorize(['superadmin']), adminLimiter, async (req, res) => {
  try {
    const t = await Testimonial.findByPk(req.params.id);
    if (!t) return res.status(404).json({ message: 'Not found' });
    await t.destroy();
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ message: 'Error deleting testimonial', error: err.message });
  }
});

// Admin: create
router.post('/', authenticate, authorize(['superadmin']), adminLimiter, async (req, res) => {
  try {
    const { name, country, flag, phone, type, amount_nsl } = req.body;
    if (!name || !country || !phone || !type || !amount_nsl) {
      return res.status(400).json({ message: 'name, country, phone, type, amount_nsl required' });
    }
    const t = await Testimonial.create({ name, country, flag: flag || '', phone, type, amount_nsl });
    res.status(201).json({ testimonial: t });
  } catch (err) {
    res.status(500).json({ message: 'Error creating testimonial', error: err.message });
  }
});

module.exports = router;
