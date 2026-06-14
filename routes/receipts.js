const express = require('express');
const router = express.Router();
const CommunicationLog = require('../models/CommunicationLog');

// POST /api/receipts
// Webhook for Channel Simulator to update delivery statuses
router.post('/', async (req, res) => {
  const { communication_id, status, timestamp } = req.body;

  if (!communication_id || !status) {
    return res.status(400).json({ error: 'Invalid payload' });
  }

  try {
    const comm = await CommunicationLog.findById(communication_id);
    if (!comm) {
      return res.status(404).json({ error: 'Communication not found' });
    }

    comm.status = status;
    if (status === 'DELIVERED') comm.deliveredAt = timestamp || new Date();
    else if (status === 'FAILED') comm.failedAt = timestamp || new Date();
    else if (status === 'OPENED') comm.openedAt = timestamp || new Date();
    else if (status === 'CLICKED') comm.clickedAt = timestamp || new Date();

    await comm.save();

    res.status(200).json({ message: 'Status updated' });
  } catch (error) {
    console.error('Error processing receipt:', error);
    res.status(500).json({ error: 'Failed to process receipt' });
  }
});

// POST /api/receipts/campaign-complete
// Webhook for Channel Simulator to notify that all scheduled events for this campaign are completed
router.post('/campaign-complete', async (req, res) => {
  const { campaign_id } = req.body;
  if (!campaign_id) {
    return res.status(400).json({ error: 'campaign_id is required' });
  }

  try {
    const Campaign = require('../models/Campaign');
    const campaignObj = await Campaign.findById(campaign_id);
    if (!campaignObj) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    if (campaignObj.status !== 'Completed') {
      // Generate random revenue based on campaign clicks
      const CommunicationLog = require('../models/CommunicationLog');
      const clickedCount = await CommunicationLog.countDocuments({ campaign_id: campaignObj._id, status: 'CLICKED' });
      const sentCount = await CommunicationLog.countDocuments({ campaign_id: campaignObj._id, status: { $in: ['SENT', 'DELIVERED', 'OPENED', 'CLICKED', 'FAILED'] } });
      
      // Random revenue: each conversion generates a reasonable AOV
      const conversions = clickedCount > 0 
        ? Math.max(1, Math.floor(clickedCount * (0.05 + Math.random() * 0.15))) // 5-20% of clicks convert
        : (sentCount > 0 ? (Math.random() > 0.8 ? 1 : 0) : 0); // 20% chance of 1 conversion if no clicks
      
      const aov = Math.floor(Math.random() * 800) + 200; // ₹200 to ₹1000 per order
      const totalRevenue = conversions * aov;
      
      campaignObj.status = 'Completed';
      campaignObj.revenue = totalRevenue;
      campaignObj.conversions = conversions;
      await campaignObj.save();
      console.log(`Campaign ${campaign_id} marked as Completed. Revenue generated: ₹${totalRevenue}, Conversions: ${conversions}`);

      try {
        const Notification = require('../models/Notification');
        await Notification.create({
          workspaceId: campaignObj.workspaceId,
          text: `Your campaign "${campaignObj.name}" completed successfully. Revenue generated: ₹${totalRevenue.toLocaleString()}.`,
          type: 'campaign'
        });
      } catch (err) {
        console.error('Failed to create campaign completion notification:', err);
      }
    }

    res.status(200).json({ message: 'Campaign completed successfully' });
  } catch (error) {
    console.error('Error completing campaign:', error);
    res.status(500).json({ error: 'Failed to complete campaign' });
  }
});

module.exports = router;
