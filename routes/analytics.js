const express = require('express');
const router = express.Router();
const Campaign = require('../models/Campaign');
const Customer = require('../models/Customer');
const Order = require('../models/Order');
const CommunicationLog = require('../models/CommunicationLog');
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

// GET /api/analytics
router.get('/', getWorkspace, async (req, res) => {
  try {
    const workspaceId = req.workspace._id;

    // Total Campaigns
    const totalCampaigns = await Campaign.countDocuments({ workspaceId });

    // Campaigns list
    const campaigns = await Campaign.find({ workspaceId });
    const campaignIds = campaigns.map(c => c._id);

    // Logs
    const logs = await CommunicationLog.find({ campaign_id: { $in: campaignIds } });
    
    let totalSent = 0;
    let totalDelivered = 0;
    let totalOpened = 0;
    let totalClicked = 0;

    logs.forEach(log => {
      if (['SENT', 'DELIVERED', 'OPENED', 'CLICKED', 'FAILED'].includes(log.status)) totalSent++;
      if (['DELIVERED', 'OPENED', 'CLICKED'].includes(log.status)) totalDelivered++;
      if (['OPENED', 'CLICKED'].includes(log.status)) totalOpened++;
      if (log.status === 'CLICKED') totalClicked++;
    });

    const averageOpenRate = totalDelivered > 0 ? (totalOpened / totalDelivered) * 100 : 0;
    const averageClickRate = totalOpened > 0 ? (totalClicked / totalOpened) * 100 : 0;

    // Initialize trend data
    let trendData = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      trendData.push({
        date: d.toLocaleDateString('en-US', { weekday: 'short' }),
        revenue: 0,
        _dateStr: d.toISOString().split('T')[0]
      });
    }

    // Detailed Campaign Analytics — revenue is stored on campaign when it completes
    let campaignTotalRevenue = 0;
    let campaignTotalConversions = 0;

    const campaignAnalytics = campaigns.map(c => {
      const campLogs = logs.filter(l => l.campaign_id.toString() === c._id.toString());
      let sent = 0, delivered = 0, opened = 0, clicked = 0;
      
      campLogs.forEach(log => {
        if (['SENT', 'DELIVERED', 'OPENED', 'CLICKED', 'FAILED'].includes(log.status)) sent++;
        if (['DELIVERED', 'OPENED', 'CLICKED'].includes(log.status)) delivered++;
        if (['OPENED', 'CLICKED'].includes(log.status)) opened++;
        if (log.status === 'CLICKED') clicked++;
      });

      const revenue = c.revenue || 0;
      const conversions = c.conversions || 0;
      campaignTotalRevenue += revenue;
      campaignTotalConversions += conversions;

      return {
        id: c._id,
        name: c.name,
        audience: c.audience,
        channel: c.channel,
        sent,
        delivered,
        opened,
        clicked,
        revenue,
        conversions,
        status: c.status,
        createdAt: c.createdAt
      };
    });

    // Orders Revenue & Conversions
    const orders = await Order.find({ workspaceId });
    const orderRevenue = orders.reduce((sum, order) => sum + order.amount, 0);
    const totalRevenue = orderRevenue + campaignTotalRevenue;
    const totalConversions = orders.length + campaignTotalConversions;

    // Distribute campaign revenue into trend data based on campaign updatedAt date
    campaigns.forEach(c => {
      if ((c.revenue || 0) > 0 && c.updatedAt) {
        const cDate = new Date(c.updatedAt).toISOString().split('T')[0];
        const day = trendData.find(d => d._dateStr === cDate);
        if (day) {
          day.revenue += c.revenue;
        }
      }
    });

    // Distribute orders in trend data
    orders.forEach(o => {
      if (!o.orderDate) return;
      const oDate = new Date(o.orderDate).toISOString().split('T')[0];
      const day = trendData.find(d => d._dateStr === oDate);
      if (day) {
        day.revenue += (Number(o.amount) || 0);
      }
    });

    // Customer analytics
    const customers = await Customer.find({ workspaceId });
    const totalCustomers = customers.length;
    let activeCustomers = 0;
    let inactiveCustomers = 0;
    let vipCustomers = 0;
    
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    customers.forEach(c => {
      if (c.tags && c.tags.includes('VIP')) vipCustomers++;
      if (c.last_purchase_date && c.last_purchase_date > thirtyDaysAgo) {
        activeCustomers++;
      } else {
        inactiveCustomers++;
      }
    });

    // Channel Analytics
    const channels = ['EMAIL', 'WHATSAPP', 'SMS', 'RCS'];
    const channelAnalytics = channels.map(ch => {
      const chLogs = logs.filter(l => l.channel === ch);
      let sent = 0, delivered = 0, opened = 0, clicked = 0;
      chLogs.forEach(log => {
        if (['SENT', 'DELIVERED', 'OPENED', 'CLICKED', 'FAILED'].includes(log.status)) sent++;
        if (['DELIVERED', 'OPENED', 'CLICKED'].includes(log.status)) delivered++;
        if (['OPENED', 'CLICKED'].includes(log.status)) opened++;
        if (log.status === 'CLICKED') clicked++;
      });
      return {
        channel: ch,
        sent,
        deliveredRate: sent > 0 ? (delivered / sent) * 100 : 0,
        openRate: delivered > 0 ? (opened / delivered) * 100 : 0,
        clickRate: opened > 0 ? (clicked / opened) * 100 : 0,
        conversionRate: sent > 0 ? (Math.round(clicked * 0.2) / sent) * 100 : 0
      };
    });

    res.json({
      overview: {
        totalCampaigns,
        totalMessagesSent: totalSent,
        totalRevenue,
        totalConversions,
        averageOpenRate,
        averageClickRate
      },
      customerAnalytics: {
        totalCustomers,
        activeCustomers,
        inactiveCustomers,
        vipCustomers
      },
      campaignAnalytics,
      channelAnalytics,
      revenueAnalytics: {
        totalRevenue,
        averageOrderValue: totalConversions > 0 ? totalRevenue / totalConversions : 0,
        trend: trendData.map(({ date, revenue }) => ({ date, revenue }))
      }
    });

  } catch (err) {
    console.error('Analytics Error:', err);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

module.exports = router;
