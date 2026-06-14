const express = require('express');
const router = express.Router();
const Customer = require('../models/Customer');
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

// GET /api/customers
router.get('/', getWorkspace, async (req, res) => {
  try {
    const search = req.query.search;
    let query = { workspaceId: req.workspace._id };
    
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
        { city: { $regex: search, $options: 'i' } },
        { state: { $regex: search, $options: 'i' } },
        { country: { $regex: search, $options: 'i' } },
        { tags: { $regex: search, $options: 'i' } }
      ];
    }
    
    const customers = await Customer.find(query).sort({ createdAt: -1 });
    res.json(customers);
  } catch (error) {
    console.error('Error fetching customers:', error);
    res.status(500).json({ error: 'Failed to fetch customers' });
  }
});

// GET /api/customers/:id
router.get('/:id', getWorkspace, async (req, res) => {
  try {
    const customer = await Customer.findOne({ _id: req.params.id, workspaceId: req.workspace._id });
    if (!customer) return res.status(404).json({ error: 'Customer not found' });

    const campaignsCount = await CommunicationLog.countDocuments({ customer_id: customer._id });
    const logs = await CommunicationLog.find({ customer_id: customer._id })
      .populate('campaign_id')
      .sort({ sentAt: -1 });

    res.json({
      ...customer.toObject(),
      campaignsReceivedCount: campaignsCount,
      campaignLogs: logs
    });
  } catch (err) {
    console.error('Error fetching customer details:', err);
    res.status(500).json({ error: 'Failed to fetch customer' });
  }
});

// POST /api/customers
router.post('/', getWorkspace, async (req, res) => {
  try {
    const emailLower = (req.body.email || '').trim().toLowerCase();
    let existing = await Customer.findOne({ workspaceId: req.workspace._id, email: emailLower });
    if (existing) return res.status(400).json({ error: 'Customer with this email already exists' });

    // Also check if they exist by name with a dummy email (created during order imports)
    if (req.body.name) {
      const normalizedName = req.body.name.trim().replace(/\s+/g, ' ');
      existing = await Customer.findOne({
        workspaceId: req.workspace._id,
        name: { $regex: new RegExp('^' + normalizedName.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&') + '$', 'i') },
        email: /@imported\.local$/
      });
    }

    if (existing) {
      // Merge the details into the existing customer record
      existing.email = emailLower;
      if (req.body.phone) existing.phone = req.body.phone;
      if (req.body.gender) existing.gender = req.body.gender;
      if (req.body.dob) existing.dob = req.body.dob;
      if (req.body.city) existing.city = req.body.city;
      if (req.body.state) existing.state = req.body.state;
      if (req.body.country) existing.country = req.body.country;
      if (req.body.tags) {
        existing.tags = Array.from(new Set([...(existing.tags || []), ...req.body.tags]));
      }
      await existing.save();
      return res.status(200).json(existing);
    }

    const customer = new Customer({
      ...req.body,
      email: emailLower,
      workspaceId: req.workspace._id
    });
    await customer.save();

    try {
      const Notification = require('../models/Notification');
      await Notification.create({
        workspaceId: req.workspace._id,
        text: `Customer "${customer.name}" was successfully added to your database.`,
        type: 'customer'
      });
    } catch (err) {
      console.error('Failed to create customer notification:', err);
    }

    res.status(201).json(customer);
  } catch (error) {
    console.error('Error adding customer:', error);
    res.status(500).json({ error: 'Failed to add customer' });
  }
});

// PUT /api/customers/:id
router.put('/:id', getWorkspace, async (req, res) => {
  try {
    const customer = await Customer.findOneAndUpdate(
      { _id: req.params.id, workspaceId: req.workspace._id },
      { ...req.body },
      { new: true }
    );
    if (!customer) return res.status(404).json({ error: 'Customer not found' });
    res.json(customer);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update customer' });
  }
});

const CommunicationLog = require('../models/CommunicationLog');

// DELETE /api/customers/:id
router.delete('/:id', getWorkspace, async (req, res) => {
  try {
    const customer = await Customer.findOneAndDelete({ _id: req.params.id, workspaceId: req.workspace._id });
    if (!customer) return res.status(404).json({ error: 'Customer not found' });
    
    // Cascading delete: remove associated communication logs
    await CommunicationLog.deleteMany({ customer_id: customer._id });

    res.json({ message: 'Customer deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete customer' });
  }
});

// POST /api/customers/import
router.post('/import', getWorkspace, async (req, res) => {
  try {
    const customersData = req.body.customers;
    if (!Array.isArray(customersData)) return res.status(400).json({ error: 'Expected array of customers' });

    let processedCount = 0;
    
    // Fetch all existing customers for this workspace to do in-memory matching
    const existingCustomers = await Customer.find(
      { workspaceId: req.workspace._id }, 
      '_id name email phone city state country tags'
    );
    
    const byEmail = new Map();
    const byName = new Map();
    
    for (const c of existingCustomers) {
      if (c.email) byEmail.set(c.email.toLowerCase(), c);
      if (c.name) {
        const normalizedName = c.name.trim().replace(/\s+/g, ' ').toLowerCase();
        byName.set(normalizedName, c);
      }
    }
    
    const ops = [];

    for (const row of customersData) {
      if (!row.email || !row.name) continue; // Skip invalid rows
      
      const normalizedEmail = row.email.trim().toLowerCase();
      const normalizedName = row.name.trim().replace(/\s+/g, ' ').toLowerCase();
      
      // Find existing customer by email or name
      let existing = byEmail.get(normalizedEmail) || byName.get(normalizedName);
      
      if (existing) {
        let changed = false;
        // If existing email is generated (imported.local) and CSV has a real one, update it
        if (existing.email && existing.email.endsWith('@imported.local') && !normalizedEmail.endsWith('@imported.local')) {
          existing.email = normalizedEmail;
          changed = true;
        }
        if (row.phone && existing.phone !== row.phone) {
          existing.phone = row.phone;
          changed = true;
        }
        if (row.city && (!existing.city || existing.city === '-')) {
          existing.city = row.city;
          changed = true;
        }
        if (row.state && (!existing.state || existing.state === '-')) {
          existing.state = row.state;
          changed = true;
        }
        if (row.country && (!existing.country || existing.country === '-')) {
          existing.country = row.country;
          changed = true;
        }
        if (row.tags && Array.isArray(row.tags) && row.tags.length > 0) {
          const currentTags = existing.tags || [];
          const newTags = Array.from(new Set([...currentTags, ...row.tags]));
          if (newTags.length !== currentTags.length) {
            existing.tags = newTags;
            changed = true;
          }
        }
        
        if (changed && existing._id) {
          ops.push({
            updateOne: {
              filter: { _id: existing._id },
              update: { $set: { 
                email: existing.email,
                phone: existing.phone,
                city: existing.city,
                state: existing.state,
                country: existing.country,
                tags: existing.tags
              }}
            }
          });
        }
      } else {
        // Create new
        const newCust = {
          workspaceId: req.workspace._id,
          name: row.name.trim(),
          email: normalizedEmail,
          phone: row.phone || '',
          city: row.city || '-',
          state: row.state || '-',
          country: row.country || '-',
          tags: row.tags || []
        };
        
        // Add to lookups to prevent duplicates within the same CSV
        byEmail.set(normalizedEmail, newCust);
        byName.set(normalizedName, newCust);
        
        ops.push({
          insertOne: {
            document: newCust
          }
        });
      }
      processedCount++;
    }
    
    if (ops.length > 0) {
      await Customer.bulkWrite(ops);
    }
    try {
      const Notification = require('../models/Notification');
      await Notification.create({
        workspaceId: req.workspace._id,
        text: `Successfully imported ${processedCount} customers from your data file.`,
        type: 'customer'
      });
    } catch (err) {
      console.error('Failed to create customer import notification:', err);
    }
    
    res.status(201).json({ message: `Successfully processed ${processedCount} customers.` });
  } catch (error) {
    console.error('Error importing customers:', error);
    res.status(500).json({ error: 'Failed to import customers' });
  }
});

module.exports = router;
