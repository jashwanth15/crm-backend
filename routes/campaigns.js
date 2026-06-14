const express = require('express');
const router = express.Router();
const Campaign = require('../models/Campaign');
const CommunicationLog = require('../models/CommunicationLog');
const Customer = require('../models/Customer');
const Workspace = require('../models/Workspace');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { draftMessage, buildAudienceQuery } = require('../services/geminiService');
const { buildMongoQueryFromRules } = require('./audience');

const mongoose = require('mongoose');

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

// GET /api/campaigns
// List all campaigns with stats for the current workspace
router.get('/', getWorkspace, async (req, res) => {
  try {
    const { search, status, channel } = req.query;
    let query = { workspaceId: req.workspace._id };

    if (search) {
      query.name = { $regex: search, $options: 'i' };
    }
    if (status) {
      query.status = status;
    }
    if (channel) {
      query.channel = channel;
    }

    const campaigns = await Campaign.find(query).sort({ createdAt: -1 });
    
    // Fetch stats for each
    const campaignsWithStats = await Promise.all(campaigns.map(async (camp) => {
      const stats = await CommunicationLog.aggregate([
        { $match: { campaign_id: camp._id } },
        { $group: { _id: '$status', count: { $sum: 1 } } }
      ]);
      const formattedStats = stats.reduce((acc, curr) => {
        acc[curr._id] = curr.count;
        return acc;
      }, {});
      return { ...camp.toObject(), stats: formattedStats };
    }));
    
    res.json(campaignsWithStats);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch campaigns' });
  }
});

// GET /api/campaigns/:id
// Get a specific campaign
router.get('/:id', getWorkspace, async (req, res) => {
  try {
    const campaign = await Campaign.findOne({ _id: req.params.id, workspaceId: req.workspace._id });
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    
    const stats = await CommunicationLog.aggregate([
      { $match: { campaign_id: campaign._id } },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);
    const formattedStats = stats.reduce((acc, curr) => {
      acc[curr._id] = curr.count;
      return acc;
    }, {});

    res.json({ ...campaign.toObject(), stats: formattedStats });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch campaign details' });
  }
});

// POST /api/campaigns/ai/message
router.post('/ai/message', getWorkspace, async (req, res) => {
  try {
    const { prompt, audience } = req.body;
    if (!prompt) return res.status(400).json({ error: 'Prompt is required' });
    const message = await draftMessage(prompt, audience || 'Customers');
    res.json({ message });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to generate message' });
  }
});

// GET /api/campaigns/:id/logs
// Get communication logs for a specific campaign, optionally filtered by status
router.get('/:id/logs', getWorkspace, async (req, res) => {
  console.log('HIT /:id/logs with id:', req.params.id);
  try {
    const campaign = await Campaign.findOne({ _id: req.params.id, workspaceId: req.workspace._id });
    console.log('Found campaign?', !!campaign);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    const filter = { campaign_id: campaign._id };
    if (req.query.status) {
      filter.status = req.query.status;
    }

    const logs = await CommunicationLog.find(filter).populate('customer_id', 'name email phone tags city');
    res.json(logs);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch communication logs' });
  }
});

// POST /api/campaigns
// Create a new campaign (Draft or Launch)
router.post('/', getWorkspace, async (req, res) => {
  console.log('HIT POST /api/campaigns with body:', req.body);
  const { name, objective, audience, channel, message, status } = req.body;

  try {
    const campaign = new Campaign({
      workspaceId: req.workspace._id,
      name,
      objective,
      audience,
      channel,
      message,
      status: status || 'Draft'
    });
    await campaign.save();
    console.log('Campaign saved:', campaign._id, 'status:', campaign.status);

    if (campaign.status === 'Running') {
      console.log('Calling launchCampaign asynchronously...');
      launchCampaign(campaign, req.workspace._id).catch(err => {
        console.error('Background launch error:', err);
      });
    }

    res.status(201).json(campaign);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to create campaign' });
  }
});

// PUT /api/campaigns/:id
// Update a campaign
router.put('/:id', getWorkspace, async (req, res) => {
  try {
    const campaign = await Campaign.findOne({ _id: req.params.id, workspaceId: req.workspace._id });
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    // Prevent major edits if it's already running or completed
    if (campaign.status === 'Running' || campaign.status === 'Completed') {
      return res.status(400).json({ error: 'Cannot edit a running or completed campaign' });
    }

    const { name, objective, audience, channel, message, status } = req.body;
    
    campaign.name = name !== undefined ? name : campaign.name;
    campaign.objective = objective !== undefined ? objective : campaign.objective;
    campaign.audience = audience !== undefined ? audience : campaign.audience;
    campaign.channel = channel !== undefined ? channel : campaign.channel;
    campaign.message = message !== undefined ? message : campaign.message;
    campaign.status = status !== undefined ? status : campaign.status;
    campaign.updatedAt = Date.now();

    await campaign.save();

    if (campaign.status === 'Running') {
      await launchCampaign(campaign, req.workspace._id);
    }

    res.json(campaign);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to update campaign' });
  }
});

// DELETE /api/campaigns/:id
router.delete('/:id', getWorkspace, async (req, res) => {
  try {
    const campaign = await Campaign.findOneAndDelete({ _id: req.params.id, workspaceId: req.workspace._id });
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    res.json({ message: 'Campaign deleted successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to delete campaign' });
  }
});

// Helper function to dispatch campaign
async function launchCampaign(campaign, workspaceId) {
  try {
    // Basic audience resolution based on text for now.
    // If we have AI, we might use buildAudienceQuery. For now, a generic fetch or simple regex if needed.
    let customers = [];
    if (campaign.audience === 'All Customers') {
      customers = await Customer.find({ workspaceId });
    } else if (['VIP', 'Premium', 'Regular', 'New Customer', 'Inactive'].includes(campaign.audience)) {
      customers = await Customer.find({ workspaceId, tags: campaign.audience });
    } else if (campaign.audience) {
       const rules = await buildAudienceQuery(campaign.audience);
       const mongoQuery = await buildMongoQueryFromRules(rules, workspaceId);
       customers = await Customer.find(mongoQuery);
    }

    if (customers.length === 0) {
      campaign.status = 'Completed'; 
      await campaign.save();
      return;
    }

    const commsToInsert = customers.map(cust => {
      let personalizedMessage = campaign.message?.body || '';
      personalizedMessage = personalizedMessage.replace('{name}', cust.name).replace('{{name}}', cust.name);
      
      return {
        campaign_id: campaign._id,
        customer_id: cust._id,
        message_body: personalizedMessage,
        channel: (campaign.channel || 'Email').toUpperCase(),
        status: 'PENDING'
      };
    });

    const insertedComms = await CommunicationLog.insertMany(commsToInsert);

    const payload = insertedComms.map(c => ({ id: c._id }));
    const simulatorUrl = process.env.SIMULATOR_URL || 'http://localhost:3001';
    
    fetch(`${simulatorUrl}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        campaign_id: campaign._id,
        communications: payload 
      })
    }).catch(err => console.error('Failed to call simulator:', err.message));

    // Keep campaign as Running while it is being simulated
    campaign.status = 'Running';
    await campaign.save();

  } catch (err) {
    console.error('Error launching campaign:', err);
    campaign.status = 'Failed';
    await campaign.save();
  }
}

module.exports = router;
