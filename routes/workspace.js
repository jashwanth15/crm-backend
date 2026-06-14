const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const Workspace = require('../models/Workspace');
const Customer = require('../models/Customer');
const Order = require('../models/Order');
const Campaign = require('../models/Campaign');

// GET /api/workspace
router.get('/', verifyToken, async (req, res) => {
  try {
    const workspace = await Workspace.findOne({ ownerId: req.user.id });
    if (!workspace) return res.status(404).json({ error: 'Workspace not found' });
    res.json(workspace);
  } catch (err) {
    res.status(500).json({ error: 'Server error fetching workspace' });
  }
});

// GET /api/workspace/stats
router.get('/stats', verifyToken, async (req, res) => {
  try {
    const workspace = await Workspace.findOne({ ownerId: req.user.id });
    if (!workspace) return res.status(404).json({ error: 'Workspace not found' });

    const customerCount = await Customer.countDocuments({ workspaceId: workspace._id });
    const orderCount = await Order.countDocuments({ workspaceId: workspace._id });

    // Campaign revenue is stored directly on each campaign document
    const campaigns = await Campaign.find({ workspaceId: workspace._id });
    const campaignTotalRevenue = campaigns.reduce((sum, c) => sum + (c.revenue || 0), 0);
    
    const orders = await Order.find({ workspaceId: workspace._id, orderStatus: { $in: ['Completed', 'Pending'] } });
    const orderRevenue = orders.reduce((sum, o) => sum + (Number(o.amount) || 0), 0);
    const revenue = orderRevenue + campaignTotalRevenue;

    const campaignCount = await Campaign.countDocuments({ workspaceId: workspace._id, status: { $in: ['Running', 'Scheduled'] } });

    const { range, start, end } = req.query || { range: '7d' };

    const trendData = [];
    let resolution = 'day';

    if (range === 'custom' && start && end) {
      const startDate = new Date(start);
      const endDate = new Date(end);
      const diffDays = Math.ceil(Math.abs(endDate - startDate) / (1000 * 60 * 60 * 24));
      
      if (diffDays > 730) {
        resolution = 'year';
        const diffYears = endDate.getFullYear() - startDate.getFullYear();
        for (let i = diffYears; i >= 0; i--) {
          const d = new Date(endDate);
          d.setFullYear(d.getFullYear() - i);
          trendData.push({ name: d.getFullYear().toString(), revenue: 0, _matchStr: d.getFullYear().toString() });
        }
      } else if (diffDays > 60) {
        resolution = 'month';
        const diffMonths = (endDate.getFullYear() - startDate.getFullYear()) * 12 + (endDate.getMonth() - startDate.getMonth());
        for (let i = diffMonths; i >= 0; i--) {
          const d = new Date(endDate);
          d.setMonth(d.getMonth() - i);
          trendData.push({ name: d.toLocaleDateString('en-US', { month: 'short' }), revenue: 0, _matchStr: `${d.getFullYear()}-${d.getMonth()}` });
        }
      } else {
        resolution = 'day';
        for (let i = diffDays; i >= 0; i--) {
          const d = new Date(endDate);
          d.setDate(d.getDate() - i);
          trendData.push({ name: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), revenue: 0, _matchStr: d.toISOString().split('T')[0] });
        }
      }
    } else if (range === '5y') {
      resolution = 'year';
      for (let i = 4; i >= 0; i--) {
        const d = new Date();
        d.setFullYear(d.getFullYear() - i);
        trendData.push({ name: d.getFullYear().toString(), revenue: 0, _matchStr: d.getFullYear().toString() });
      }
    } else if (range === '12m') {
      resolution = 'month';
      for (let i = 11; i >= 0; i--) {
        const d = new Date();
        d.setMonth(d.getMonth() - i);
        trendData.push({ name: d.toLocaleDateString('en-US', { month: 'short' }), revenue: 0, _matchStr: `${d.getFullYear()}-${d.getMonth()}` });
      }
    } else if (range === '30d') {
      resolution = 'day';
      for (let i = 29; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        trendData.push({ name: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), revenue: 0, _matchStr: d.toISOString().split('T')[0] });
      }
    } else {
      // Default 7 days
      resolution = 'day';
      for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        trendData.push({ name: d.toLocaleDateString('en-US', { weekday: 'short' }), revenue: 0, _matchStr: d.toISOString().split('T')[0] });
      }
    }

    // Distribute orders in trend data
    orders.forEach(o => {
      if (!o.orderDate) return;
      const d = new Date(o.orderDate);
      let matchStr = '';
      if (resolution === 'year') {
        matchStr = d.getFullYear().toString();
      } else if (resolution === 'month') {
        matchStr = `${d.getFullYear()}-${d.getMonth()}`;
      } else {
        matchStr = d.toISOString().split('T')[0];
      }
      
      const bucket = trendData.find(b => b._matchStr === matchStr);
      if (bucket) {
        bucket.revenue += (Number(o.amount) || 0);
      }
    });

    // Distribute campaign revenue in trend data based on campaign completion date
    campaigns.forEach(c => {
      if ((c.revenue || 0) > 0 && c.updatedAt) {
        const d = new Date(c.updatedAt);
        let matchStr = '';
        if (resolution === 'year') {
          matchStr = d.getFullYear().toString();
        } else if (resolution === 'month') {
          matchStr = `${d.getFullYear()}-${d.getMonth()}`;
        } else {
          matchStr = d.toISOString().split('T')[0];
        }
        
        const bucket = trendData.find(b => b._matchStr === matchStr);
        if (bucket) {
          bucket.revenue += c.revenue;
        }
      }
    });

    res.json({
      customerCount,
      orderCount,
      revenue,
      campaignCount,
      trendData: trendData.map(({name, revenue}) => ({name, revenue}))
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error fetching stats' });
  }
});

// POST /api/workspace
router.post('/', verifyToken, async (req, res) => {
  try {
    let workspace = await Workspace.findOne({ ownerId: req.user.id });
    if (workspace) return res.status(400).json({ error: 'Workspace already exists for this user' });

    workspace = new Workspace({
      ownerId: req.user.id,
      ...req.body
    });

    await workspace.save();
    res.status(201).json(workspace);
  } catch (err) {
    res.status(500).json({ error: 'Server error creating workspace' });
  }
});

// PUT /api/workspace
router.put('/', verifyToken, async (req, res) => {
  try {
    // Prevent ownerId from being modified
    const updateData = { ...req.body };
    delete updateData.ownerId;
    delete updateData._id;

    const workspace = await Workspace.findOneAndUpdate(
      { ownerId: req.user.id },
      { $set: updateData },
      { new: true, runValidators: true }
    );
    if (!workspace) return res.status(404).json({ error: 'Workspace not found' });

    try {
      const Notification = require('../models/Notification');
      let text = 'Your workspace settings have been updated.';
      if (updateData.appearance) {
        text = 'Your workspace Appearance settings have been updated.';
      }
      await Notification.create({
        workspaceId: workspace._id,
        text,
        type: 'system'
      });
    } catch (err) {
      console.error('Failed to create workspace notification:', err);
    }

    res.json(workspace);
  } catch (err) {
    res.status(500).json({ error: 'Server error updating workspace' });
  }
});

module.exports = router;
