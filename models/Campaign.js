const mongoose = require('mongoose');

const campaignSchema = new mongoose.Schema({
  workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true },
  name: { type: String, required: true },
  objective: { type: String },
  audience: { type: String }, // e.g. "VIP Customers", "All Customers"
  message: {
    messageType: { type: String, default: 'Promotion' },
    subject: { type: String },
    body: { type: String },
    imageUrl: { type: String },
    buttons: [{ 
      text: { type: String },
      url: { type: String },
      type: { type: String, enum: ['url', 'reply'], default: 'url' }
    }]
  },
  channel: { type: String, enum: ['Email', 'SMS', 'WhatsApp', 'RCS'], default: 'WhatsApp' },
  status: { type: String, enum: ['Draft', 'Scheduled', 'Running', 'Completed', 'Cancelled', 'Failed'], default: 'Draft' },
  revenue: { type: Number, default: 0 },
  conversions: { type: Number, default: 0 },
}, { timestamps: true });

// Index for quick querying by workspace
campaignSchema.index({ workspaceId: 1, createdAt: -1 });

module.exports = mongoose.model('Campaign', campaignSchema);
