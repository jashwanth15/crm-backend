const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const Customer = require('../models/Customer');
const Order = require('../models/Order');
const Campaign = require('../models/Campaign');
const Workspace = require('../models/Workspace');

// Middleware to attach workspace to req
const getWorkspace = async (req, res, next) => {
  try {
    const ownerId = req.user ? req.user.id : (await Workspace.findOne()).ownerId;
    const workspace = await Workspace.findOne({ ownerId });
    if (!workspace) return res.status(404).json({ error: 'Workspace not found' });
    req.workspace = workspace;
    next();
  } catch (err) {
    res.status(500).json({ error: 'Failed to find workspace' });
  }
};

router.get('/:type', verifyToken, getWorkspace, async (req, res) => {
  const { type } = req.params;
  const workspaceId = req.workspace._id;

  try {
    let data = [];
    let filename = '';

    if (type === 'customers') {
      data = await Customer.find({ workspaceId }).lean();
      filename = 'customers_export.json';
    } else if (type === 'orders') {
      data = await Order.find({ workspaceId }).lean();
      filename = 'orders_export.json';
    } else if (type === 'campaigns') {
      data = await Campaign.find({ workspaceId }).lean();
      filename = 'campaigns_export.json';
    } else if (type === 'analytics') {
      const customers = await Customer.countDocuments({ workspaceId });
      const orders = await Order.countDocuments({ workspaceId });
      const campaigns = await Campaign.countDocuments({ workspaceId });
      data = [{ customers, orders, campaigns, exportDate: new Date() }];
      filename = 'analytics_export.json';
    } else {
      return res.status(400).json({ error: 'Invalid export type' });
    }

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
    res.send(JSON.stringify(data, null, 2));

  } catch (err) {
    console.error('Export Error:', err);
    res.status(500).json({ error: 'Failed to export data' });
  }
});

module.exports = router;
