require('dotenv').config();
const mongoose = require('mongoose');
const Customer = require('./models/Customer');
const Workspace = require('./models/Workspace');

async function checkCustomers() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/xeno-crm');
    console.log('Connected to DB');
    
    const customers = await Customer.find({});
    console.log(`Total customers: ${customers.length}`);
    
    if (customers.length > 0) {
      console.log('Sample customer workspaceId:', customers[0].workspaceId);
    }

    const workspaces = await Workspace.find({});
    if (workspaces.length > 0) {
      console.log('First workspace ID:', workspaces[0]._id);
    }
    
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

checkCustomers();
