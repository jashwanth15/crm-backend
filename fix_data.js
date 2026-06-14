require('dotenv').config();
const mongoose = require('mongoose');
const Order = require('./models/Order');
const Campaign = require('./models/Campaign');

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);

  // Fix all orders to have an amount between 300 and 1500
  const orders = await Order.find();
  for (let o of orders) {
    if (o.amount > 2000) {
       o.amount = Math.floor(Math.random() * 1200) + 300;
       await o.save();
    }
  }

  // Fix campaigns
  const campaigns = await Campaign.find({ status: 'Completed' });
  for (let c of campaigns) {
    if (c.conversions > 0) {
      // Calculate a realistic revenue for this campaign
      const aov = Math.floor(Math.random() * 800) + 200;
      c.revenue = c.conversions * aov;
      await c.save();
    } else {
      c.revenue = 0;
      await c.save();
    }
  }

  console.log('Fixed database numbers.');
  process.exit(0);
}

run();
