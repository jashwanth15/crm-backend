const mongoose = require('mongoose');

const customerSchema = new mongoose.Schema({
  workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true },
  name: { type: String, required: true },
  email: { type: String, required: true },
  phone: { type: String },
  gender: { type: String },
  dob: { type: Date },
  city: { type: String },
  state: { type: String },
  country: { type: String },
  tags: [{ type: String }],
  lifetime_value: { type: Number, default: 0 },
  purchase_frequency: { type: Number, default: 0 },
  last_purchase_date: { type: Date }
}, { timestamps: true });

// Compound index to ensure email is unique per workspace
customerSchema.index({ workspaceId: 1, email: 1 }, { unique: true });

module.exports = mongoose.model('Customer', customerSchema);
