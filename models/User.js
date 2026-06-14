const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  companyName: { type: String },
  businessType: { type: String },
  email: { type: String, required: true, unique: true },
  phone: { type: String },
  jobTitle: { type: String },
  profilePhoto: { type: String },
  passwordHash: { type: String, required: true },
  role: { type: String, default: 'marketer' },
  resetPasswordToken: { type: String },
  resetPasswordExpires: { type: Date },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', userSchema);
