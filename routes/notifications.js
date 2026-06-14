const express = require('express');
const router = express.Router();
const Notification = require('../models/Notification');
const Workspace = require('../models/Workspace');

// Middleware to attach workspace to req
const getWorkspace = async (req, res, next) => {
  try {
    const workspace = await Workspace.findOne({ ownerId: req.user.id });
    if (!workspace) return res.status(404).json({ error: 'Workspace not found' });
    req.workspace = workspace;
    next();
  } catch (err) {
    res.status(500).json({ error: 'Failed to find workspace' });
  }
};

// GET /api/notifications
router.get('/', getWorkspace, async (req, res) => {
  try {
    const notifications = await Notification.find({ workspaceId: req.workspace._id })
      .sort({ createdAt: -1 })
      .limit(50);
    res.json(notifications);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

// PUT /api/notifications/read-all
router.put('/read-all', getWorkspace, async (req, res) => {
  try {
    await Notification.updateMany(
      { workspaceId: req.workspace._id, read: false },
      { $set: { read: true } }
    );
    res.json({ message: 'All notifications marked as read' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to mark notifications as read' });
  }
});

// PUT /api/notifications/read/:id
router.put('/read/:id', getWorkspace, async (req, res) => {
  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, workspaceId: req.workspace._id },
      { $set: { read: true } },
      { new: true }
    );
    if (!notification) return res.status(404).json({ error: 'Notification not found' });
    res.json(notification);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update notification' });
  }
});

module.exports = router;
