const mongoose = require('mongoose');

const ruleSchema = new mongoose.Schema({
  field: { type: String, required: true },
  operator: { type: String, required: true },
  value: { type: mongoose.Schema.Types.Mixed, required: true }
});

const audienceSchema = new mongoose.Schema({
  workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true },
  name: { type: String, required: true },
  rules: [ruleSchema],
  customerCount: { type: Number, default: 0 },
  estimatedRevenue: { type: Number, default: 0 }
}, { timestamps: true });

module.exports = mongoose.model('Audience', audienceSchema);
