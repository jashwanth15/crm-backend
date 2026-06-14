require('dotenv').config();
const mongoose = require('mongoose');
const Campaign = require('./models/Campaign');

async function cleanOldCampaigns() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/xeno-crm');
    console.log('Connected to DB');
    
    // Delete campaigns that don't have a workspaceId or are using old statuses
    const result = await Campaign.deleteMany({ workspaceId: { $exists: false } });
    console.log(`Deleted ${result.deletedCount} old campaigns without workspaceId.`);
    
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

cleanOldCampaigns();
