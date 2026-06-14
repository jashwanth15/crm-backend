const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true },
  text: { type: String, required: true },
  read: { type: Boolean, default: false },
  type: { type: String, enum: ['campaign', 'customer', 'order', 'system'], default: 'system' }
}, { timestamps: true });

module.exports = mongoose.model('Notification', notificationSchema);
