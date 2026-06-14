require('dotenv').config();
const mongoose = require('mongoose');
const Customer = require('./models/Customer');
const CommunicationLog = require('./models/CommunicationLog');

async function cleanupOrphans() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/xeno-crm');
    console.log('Connected to DB');

    const customers = await Customer.find({}, '_id');
    const validCustomerIds = customers.map(c => c._id);

    const result = await CommunicationLog.deleteMany({ customer_id: { $nin: validCustomerIds } });
    
    console.log(`Successfully deleted ${result.deletedCount} orphaned CommunicationLogs.`);
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

cleanupOrphans();
