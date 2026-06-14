require('dotenv').config();
const mongoose = require('mongoose');
const Customer = require('./models/Customer');

async function debugCustomers() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/xeno-crm');
    
    const all = await Customer.find({});
    console.log(`Total customers: ${all.length}`);
    let missingOrNull = 0;
    all.forEach(c => {
      if (!c.workspaceId) missingOrNull++;
    });
    console.log(`Missing or null workspaceId: ${missingOrNull}`);
    
    const correctWorkspace = new mongoose.Types.ObjectId('6a2b0666a752b23fa1588aac');
    const match = await Customer.find({ workspaceId: correctWorkspace });
    console.log(`Matching workspaceId 6a2b0666a752b23fa1588aac: ${match.length}`);
    
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
debugCustomers();
