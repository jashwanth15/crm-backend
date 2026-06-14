require('dotenv').config();
const mongoose = require('mongoose');
const Customer = require('./models/Customer');
const Order = require('./models/Order');
const Workspace = require('./models/Workspace');

async function fixWorkspaceIds() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/xeno-crm');
    console.log('Connected to DB');

    const workspace = await Workspace.findOne({});
    if (!workspace) {
      console.log('No workspace found to attach to.');
      process.exit(1);
    }
    
    console.log('Using workspace ID:', workspace._id);

    const customerUpdate = await Customer.updateMany(
      { workspaceId: { $exists: false } },
      { $set: { workspaceId: workspace._id } }
    );
    console.log(`Updated ${customerUpdate.modifiedCount} Customers with workspaceId.`);

    const orderUpdate = await Order.updateMany(
      { workspaceId: { $exists: false } },
      { $set: { workspaceId: workspace._id } }
    );
    console.log(`Updated ${orderUpdate.modifiedCount} Orders with workspaceId.`);
    
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

fixWorkspaceIds();
