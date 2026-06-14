const express = require('express');
const router = express.Router();
const Order = require('../models/Order');
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

// Helper to recalculate and update a customer's spend metrics
const updateCustomerMetrics = async (customerId, workspaceId) => {
  const allOrders = await Order.find({ customerId, workspaceId });

  // Only Completed and Pending orders contribute to lifetime value
  const revenueOrders = allOrders.filter(o => ['Completed', 'Pending'].includes(o.orderStatus));
  const lifetime_value = revenueOrders.reduce((sum, o) => sum + (Number(o.amount) || 0), 0);
  
  // Total orders count (purchase frequency) includes all orders
  const purchase_frequency = allOrders.length;
  
  let last_purchase_date = null;
  if (allOrders.length > 0) {
    const sorted = [...allOrders].sort((a, b) => new Date(b.orderDate) - new Date(a.orderDate));
    last_purchase_date = sorted[0].orderDate;
  }

  await Customer.findByIdAndUpdate(customerId, {
    lifetime_value,
    purchase_frequency,
    last_purchase_date
  });
};

// GET /api/orders
router.get('/', getWorkspace, async (req, res) => {
  try {
    const { search, status, customerId } = req.query;
    let query = { workspaceId: req.workspace._id };
    
    if (status) query.orderStatus = status;
    if (customerId) query.customerId = customerId;

    let orders = await Order.find(query)
      .populate('customerId')
      .sort({ orderDate: -1 });

    if (search) {
      const s = search.toLowerCase().trim();
      orders = orders.filter(order => {
        const product = (order.productName || '').toLowerCase();
        const category = (order.category || '').toLowerCase();
        const qty = String(order.quantity || '');
        const amountVal = String(order.amount || '');
        const amountFormatted = `$${Number(order.amount || 0).toFixed(2)}`;
        const statusVal = (order.orderStatus || '').toLowerCase();
        
        // Customer fields
        const custName = order.customerId ? (order.customerId.name || '').toLowerCase() : '';
        const custEmail = order.customerId ? (order.customerId.email || '').toLowerCase() : '';
        const custPhone = order.customerId ? (order.customerId.phone || '').toLowerCase() : '';
        const custCity = order.customerId ? (order.customerId.city || '').toLowerCase() : '';
        const custState = order.customerId ? (order.customerId.state || '').toLowerCase() : '';
        const custCountry = order.customerId ? (order.customerId.country || '').toLowerCase() : '';
        const custTags = order.customerId && Array.isArray(order.customerId.tags)
          ? order.customerId.tags.join(' ').toLowerCase()
          : '';

        // Date fields
        const dateObj = new Date(order.orderDate);
        const dateStr = dateObj.toLocaleDateString().toLowerCase(); // e.g. "6/14/2026"
        const dateISO = dateObj.toISOString().toLowerCase();
        const dateUTC = dateObj.toUTCString().toLowerCase();
        const dateString = dateObj.toDateString().toLowerCase(); // e.g. "sun jun 14 2026"
        
        const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
        const monthName = months[dateObj.getMonth()] || '';
        
        // Check if any of these match the search term
        return product.includes(s) ||
               category.includes(s) ||
               qty.includes(s) ||
               amountVal.includes(s) ||
               amountFormatted.includes(s) ||
               statusVal.includes(s) ||
               custName.includes(s) ||
               custEmail.includes(s) ||
               custPhone.includes(s) ||
               custCity.includes(s) ||
               custState.includes(s) ||
               custCountry.includes(s) ||
               custTags.includes(s) ||
               dateStr.includes(s) ||
               dateISO.includes(s) ||
               dateUTC.includes(s) ||
               dateString.includes(s) ||
               monthName.includes(s);
      });
    }
    
    res.json(orders);
  } catch (error) {
    console.error('Error fetching orders:', error);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

// GET /api/orders/:id
router.get('/:id', getWorkspace, async (req, res) => {
  try {
    const order = await Order.findOne({ _id: req.params.id, workspaceId: req.workspace._id })
      .populate('customerId', 'name email phone');
    if (!order) return res.status(404).json({ error: 'Order not found' });
    res.json(order);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch order' });
  }
});

// POST /api/orders
router.post('/', getWorkspace, async (req, res) => {
  try {
    const order = new Order({
      ...req.body,
      workspaceId: req.workspace._id
    });
    await order.save();
    
    // Update Customer Metrics
    await updateCustomerMetrics(order.customerId, req.workspace._id);

    // Add Notification
    try {
      const customerObj = await Customer.findById(order.customerId);
      const customerName = customerObj ? customerObj.name : 'Unknown Customer';
      const Notification = require('../models/Notification');
      await Notification.create({
        workspaceId: req.workspace._id,
        text: `New order of ₹${Number(order.amount).toFixed(2)} for customer "${customerName}" was successfully created.`,
        type: 'order'
      });
    } catch (err) {
      console.error('Failed to create order notification:', err);
    }
    
    res.status(201).json(order);
  } catch (error) {
    console.error('Error adding order:', error);
    res.status(500).json({ error: 'Failed to add order' });
  }
});

// PUT /api/orders/:id
router.put('/:id', getWorkspace, async (req, res) => {
  try {
    const order = await Order.findOneAndUpdate(
      { _id: req.params.id, workspaceId: req.workspace._id },
      { ...req.body },
      { new: true }
    );
    if (!order) return res.status(404).json({ error: 'Order not found' });
    
    // Update Customer Metrics
    await updateCustomerMetrics(order.customerId, req.workspace._id);
    
    res.json(order);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update order' });
  }
});

// DELETE /api/orders/:id
router.delete('/:id', getWorkspace, async (req, res) => {
  try {
    const order = await Order.findOneAndDelete({ _id: req.params.id, workspaceId: req.workspace._id });
    if (!order) return res.status(404).json({ error: 'Order not found' });
    
    // Update Customer Metrics
    await updateCustomerMetrics(order.customerId, req.workspace._id);
    
    res.json({ message: 'Order deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete order' });
  }
});

// POST /api/orders/import
router.post('/import', getWorkspace, async (req, res) => {
  try {
    const ordersData = req.body.orders;
    if (!Array.isArray(ordersData)) return res.status(400).json({ error: 'Expected array of orders' });

    const mongoose = require('mongoose');
    let importedCount = 0;
    
    // Fetch all existing customers for this workspace to do in-memory matching
    const existingCustomers = await Customer.find(
      { workspaceId: req.workspace._id }, 
      '_id name email phone city state country'
    );
    
    const byEmail = new Map();
    const byName = new Map();
    
    for (const c of existingCustomers) {
      const custObj = c.toObject();
      if (custObj.email) byEmail.set(custObj.email.toLowerCase(), custObj);
      if (custObj.name) {
        const normalizedName = custObj.name.trim().replace(/\s+/g, ' ').toLowerCase();
        byName.set(normalizedName, custObj);
      }
    }

    const customerOps = [];
    const orderOps = [];
    const customerMetrics = new Map(); // customerId -> metrics

    for (const row of ordersData) {
      if (!row.email && !row.customerName) continue; // Must have email or name

      const generatedEmail = `${(row.customerName || 'unknown').trim().replace(/\s+/g, '').toLowerCase()}@imported.local`;
      const searchEmail = row.email ? row.email.trim().toLowerCase() : generatedEmail;
      const normalizedName = row.customerName ? row.customerName.trim().replace(/\s+/g, ' ').toLowerCase() : '';
      
      let customer = byEmail.get(searchEmail) || (normalizedName ? byName.get(normalizedName) : null);
      
      if (!customer) {
        const newId = new mongoose.Types.ObjectId();
        customer = {
          _id: newId,
          workspaceId: req.workspace._id,
          name: row.customerName || 'Unknown Customer',
          email: searchEmail,
          phone: row.phone || '',
          city: row.city || '-',
          state: row.state || '-',
          country: row.country || '-',
          isNewCust: true
        };
        
        byEmail.set(searchEmail, customer);
        if (normalizedName) byName.set(normalizedName, customer);
        
        customerOps.push({
          insertOne: { document: customer }
        });
      } else {
        let changed = false;
        
        if (customer.email && customer.email.endsWith('@imported.local') && row.email && !row.email.endsWith('@imported.local')) {
          customer.email = row.email.trim().toLowerCase();
          changed = true;
        }
        if (!customer.phone && row.phone) {
          customer.phone = row.phone;
          changed = true;
        }
        if ((!customer.city || customer.city === '-') && row.city) {
          customer.city = row.city;
          changed = true;
        }
        if ((!customer.state || customer.state === '-') && row.state) {
          customer.state = row.state;
          changed = true;
        }
        if ((!customer.country || customer.country === '-') && row.country) {
          customer.country = row.country;
          changed = true;
        }
        
        if (changed && !customer.isNewCust) {
          // Avoid pushing duplicate updateOnes for same existing customer by tracking updated status
          if (!customer.updated) {
            customer.updated = true;
            customerOps.push({
              updateOne: {
                filter: { _id: customer._id },
                update: { $set: { 
                  email: customer.email,
                  phone: customer.phone,
                  city: customer.city,
                  state: customer.state,
                  country: customer.country
                }}
              }
            });
          } else {
            // Update the existing updateOne operation
            const op = customerOps.find(op => op.updateOne && op.updateOne.filter._id.toString() === customer._id.toString());
            if (op) {
              op.updateOne.update.$set = {
                email: customer.email,
                phone: customer.phone,
                city: customer.city,
                state: customer.state,
                country: customer.country
              };
            }
          }
        }
      }

      let parsedDate = row.date ? new Date(row.date) : new Date();
      if (isNaN(parsedDate.getTime())) parsedDate = new Date();
      
      let parsedStatus = (row.status || 'Completed').trim();
      parsedStatus = parsedStatus.charAt(0).toUpperCase() + parsedStatus.slice(1).toLowerCase();
      if (!['Pending', 'Completed', 'Cancelled', 'Returned'].includes(parsedStatus)) {
        parsedStatus = 'Completed';
      }

      const amount = Number(row.amount) || 0;

      orderOps.push({
        insertOne: {
          document: {
            workspaceId: req.workspace._id,
            customerId: customer._id,
            productName: row.productName || 'Imported Product',
            category: row.category || '',
            quantity: Number(row.quantity) || 1,
            amount: amount,
            orderDate: parsedDate,
            orderStatus: parsedStatus
          }
        }
      });
      
      // Update metrics
      const cid = customer._id.toString();
      if (!customerMetrics.has(cid)) {
        customerMetrics.set(cid, { ltv: 0, freq: 0, lastDate: null });
      }
      const metrics = customerMetrics.get(cid);
      if (['Completed', 'Pending'].includes(parsedStatus)) {
        metrics.ltv += amount;
      }
      metrics.freq += 1;
      if (!metrics.lastDate || parsedDate > metrics.lastDate) {
        metrics.lastDate = parsedDate;
      }

      importedCount++;
    }

    // Prepare metrics updates
    for (const [cid, metrics] of customerMetrics.entries()) {
      const updateDoc = {
        $inc: { 
          lifetime_value: metrics.ltv,
          purchase_frequency: metrics.freq
        }
      };
      if (metrics.lastDate) {
        updateDoc.$max = { last_purchase_date: metrics.lastDate };
      }
      
      customerOps.push({
        updateOne: {
          filter: { _id: new mongoose.Types.ObjectId(cid) },
          update: updateDoc
        }
      });
    }

    if (customerOps.length > 0) {
      await Customer.bulkWrite(customerOps);
    }
    if (orderOps.length > 0) {
      await Order.bulkWrite(orderOps);
    }
    
    res.status(201).json({ message: `Successfully imported ${importedCount} orders.` });
  } catch (error) {
    console.error('Error importing orders:', error);
    res.status(500).json({ error: 'Failed to import orders' });
  }
});

module.exports = router;
