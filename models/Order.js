const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true },
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
  productName: { type: String, required: true },
  category: { type: String },
  quantity: { type: Number, default: 1 },
  amount: { type: Number, required: true },
  orderDate: { type: Date, default: Date.now },
  orderStatus: { type: String, enum: ['Pending', 'Completed', 'Cancelled', 'Returned'], default: 'Completed' },
  paymentStatus: { type: String, enum: ['Paid', 'Pending', 'Refunded'], default: 'Paid' }
}, { timestamps: true });

// Index for quick queries
orderSchema.index({ workspaceId: 1, customerId: 1 });
orderSchema.index({ workspaceId: 1, orderDate: -1 });

module.exports = mongoose.model('Order', orderSchema);
