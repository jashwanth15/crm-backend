const mongoose = require('mongoose');

const workspaceSchema = new mongoose.Schema({
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  businessName: { type: String, required: true },
  category: { type: String },
  email: { type: String },
  phone: { type: String },
  website: { type: String },
  address: { type: String },
  logo: { type: String },
  channels: [{ type: String }],
  goals: [{ type: String }],
  aiPreferences: {
    recommendations: { type: Boolean, default: true },
    messageGeneration: { type: Boolean, default: true },
    audienceSuggestions: { type: Boolean, default: true },
    campaignSuggestions: { type: Boolean, default: true },
    analytics: { type: Boolean, default: true }
  },
  notifications: {
    campaignAlerts: { type: Boolean, default: true },
    customerAlerts: { type: Boolean, default: true },
    orderAlerts: { type: Boolean, default: true },
    aiRecommendations: { type: Boolean, default: true },
    emailNotifications: { type: Boolean, default: true },
    browserNotifications: { type: Boolean, default: false }
  },
  appearance: {
    theme: { type: String, enum: ['Light', 'Dark', 'System'], default: 'Light' },
    language: { type: String, default: 'English' }
  },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Workspace', workspaceSchema);
