const express = require('express');
const router = express.Router();
const CommunicationLog = require('../models/CommunicationLog');

// GET /api/communications
// Fetch all communication logs
router.get('/', async (req, res) => {
  try {
    const logs = await CommunicationLog.find().populate('campaign_id').populate('customer_id').sort({ createdAt: -1 });
    res.json(logs);
  } catch (error) {
    console.error('Error fetching communication logs:', error);
    res.status(500).json({ error: 'Failed to fetch communications' });
  }
});

module.exports = router;
