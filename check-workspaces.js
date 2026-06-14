require('dotenv').config();
const mongoose = require('mongoose');
const Workspace = require('./models/Workspace');

async function checkWorkspaces() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/xeno-crm');
    const workspaces = await Workspace.find({});
    console.log(`Total workspaces: ${workspaces.length}`);
    workspaces.forEach(w => console.log(w._id, w.name, w.ownerId));
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
checkWorkspaces();
