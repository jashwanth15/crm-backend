const express = require('express');
const router = express.Router();
const Audience = require('../models/Audience');
const Customer = require('../models/Customer');
const Order = require('../models/Order');
const { buildAudienceQuery } = require('../services/geminiService');
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

// Helper to build MongoDB query from UI rules
const buildMongoQueryFromRules = async (rules, workspaceId) => {
  const query = { workspaceId };
  if (!rules || rules.length === 0) return query;

  const getMongoOp = (operator) => {
    switch (operator) {
      case '=': return '$eq';
      case '!=': return '$ne';
      case '>': return '$gt';
      case '<': return '$lt';
      case '>=': return '$gte';
      case '<=': return '$lte';
      default: return '$eq';
    }
  };

  let orderCustomerIds = null;

  for (const rule of rules) {
    let { field, operator, value } = rule;
    if (!field || !operator || value === undefined) continue;
    
    // Normalize field names that might have spaces from AI
    field = field.replace(' ', '_');

    if (field === 'product_category') {
      const orderQuery = { workspaceId };
      if (operator === 'contains') {
        orderQuery.category = { $regex: value, $options: 'i' };
      } else if (operator === '=') {
        orderQuery.category = typeof value === 'string' ? { $regex: `^${value}$`, $options: 'i' } : value;
      } else {
        orderQuery.category = { $regex: value, $options: 'i' }; // default to contains
      }
      
      const orders = await Order.find(orderQuery).select('customerId');
      const cIds = orders.map(o => o.customerId.toString());
      
      if (orderCustomerIds === null) {
        orderCustomerIds = cIds;
      } else {
        // Intersect if there are multiple product category rules
        orderCustomerIds = orderCustomerIds.filter(id => cIds.includes(id));
      }
      continue;
    }

    if (operator === 'contains') {
      if (['lifetime_value', 'purchase_frequency', 'last_purchase_days_ago'].includes(field)) {
        // Fallback to exact match for numbers if 'contains' was accidentally selected
        query[field] = isNaN(value) ? value : Number(value);
      } else {
        query[field] = { $regex: value, $options: 'i' };
      }
      continue;
    }

    if (field === 'last_purchase_days_ago') {
      const targetDate = new Date();
      targetDate.setDate(targetDate.getDate() - parseInt(value));
      const mongoOp = operator === '>' ? '$lt' : operator === '<' ? '$gt' : getMongoOp(operator);
      query['last_purchase_date'] = { ...query['last_purchase_date'], [mongoOp]: targetDate };
      continue;
    }

    if (operator === '=') {
      if (typeof value === 'string' && isNaN(value)) {
        query[field] = { $regex: `^${value}$`, $options: 'i' };
      } else {
        query[field] = isNaN(value) ? value : Number(value);
      }
    } else {
      query[field] = { ...query[field], [getMongoOp(operator)]: isNaN(value) ? value : Number(value) };
    }
  }

  if (orderCustomerIds !== null) {
    query._id = { $in: orderCustomerIds };
  }

  return query;
};

// GET all audiences
router.get('/', getWorkspace, async (req, res) => {
  try {
    const audiences = await Audience.find({ workspaceId: req.workspace._id }).sort({ createdAt: -1 });
    res.json(audiences);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch audiences' });
  }
});

// GET single audience
router.get('/:id', getWorkspace, async (req, res) => {
  try {
    const audience = await Audience.findOne({ _id: req.params.id, workspaceId: req.workspace._id });
    if (!audience) return res.status(404).json({ error: 'Audience not found' });
    
    // Also fetch the customers that match the rules so the UI can preview them
    const mongoQuery = await buildMongoQueryFromRules(audience.rules, req.workspace._id);
    const customers = await Customer.find(mongoQuery).limit(10);
    
    res.json({ audience, previewCustomers: customers });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch audience' });
  }
});

// POST preview audience (evaluates rules without saving)
router.post('/preview', getWorkspace, async (req, res) => {
  try {
    const { rules } = req.body;
    const mongoQuery = await buildMongoQueryFromRules(rules, req.workspace._id);
    console.log('AUDIENCE PREVIEW MONGO QUERY:', JSON.stringify(mongoQuery, null, 2));
    const customers = await Customer.find(mongoQuery);
    const customerCount = customers.length;
    const estimatedRevenue = customers.reduce((sum, c) => sum + (c.lifetime_value || 0), 0);
    
    res.json({
      customerCount,
      estimatedRevenue,
      customers: customers.slice(0, 10) // Only send a sample back to frontend
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to preview audience' });
  }
});

// POST AI prompt (Translates NL to Rules array)
router.post('/ai', getWorkspace, async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt) return res.status(400).json({ error: 'Prompt is required' });
    const rules = await buildAudienceQuery(prompt);
    res.json({ rules });
  } catch (error) {
    res.status(500).json({ error: 'AI processing failed' });
  }
});

// POST create audience
router.post('/', getWorkspace, async (req, res) => {
  try {
    const { name, rules } = req.body;
    
    const mongoQuery = await buildMongoQueryFromRules(rules, req.workspace._id);
    const customers = await Customer.find(mongoQuery);
    const customerCount = customers.length;
    const estimatedRevenue = customers.reduce((sum, c) => sum + (c.lifetime_value || 0), 0);

    const audience = new Audience({
      workspaceId: req.workspace._id,
      name,
      rules,
      customerCount,
      estimatedRevenue
    });
    await audience.save();
    
    res.status(201).json(audience);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create audience' });
  }
});

// PUT update audience
router.put('/:id', getWorkspace, async (req, res) => {
  try {
    const { name, rules } = req.body;
    
    const mongoQuery = await buildMongoQueryFromRules(rules, req.workspace._id);
    const customers = await Customer.find(mongoQuery);
    const customerCount = customers.length;
    const estimatedRevenue = customers.reduce((sum, c) => sum + (c.lifetime_value || 0), 0);

    const audience = await Audience.findOneAndUpdate(
      { _id: req.params.id, workspaceId: req.workspace._id },
      { name, rules, customerCount, estimatedRevenue },
      { new: true }
    );
    if (!audience) return res.status(404).json({ error: 'Audience not found' });
    
    res.json(audience);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update audience' });
  }
});

// DELETE audience
router.delete('/:id', getWorkspace, async (req, res) => {
  try {
    const audience = await Audience.findOneAndDelete({ _id: req.params.id, workspaceId: req.workspace._id });
    if (!audience) return res.status(404).json({ error: 'Audience not found' });
    res.json({ message: 'Audience deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete audience' });
  }
});

module.exports = router;
module.exports.buildMongoQueryFromRules = buildMongoQueryFromRules;
