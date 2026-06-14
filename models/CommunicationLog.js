const mongoose = require('mongoose');

const communicationLogSchema = new mongoose.Schema({
  campaign_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', required: true },
  customer_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
  message_body: { type: String, required: true },
  channel: { type: String, enum: ['EMAIL', 'SMS', 'WHATSAPP', 'RCS'], required: true },
  status: { 
    type: String, 
    enum: ['PENDING', 'SENT', 'DELIVERED', 'FAILED', 'OPENED', 'CLICKED'], 
    default: 'PENDING' 
  },
  sentAt: { type: Date, default: Date.now },
  deliveredAt: { type: Date },
  failedAt: { type: Date },
  openedAt: { type: Date },
  clickedAt: { type: Date }
});

module.exports = mongoose.model('CommunicationLog', communicationLogSchema);
