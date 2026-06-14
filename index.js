require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/workspace', require('./routes/workspace'));


// Protect other API routes
const { verifyToken } = require('./middleware/auth');
app.use('/api/audience', verifyToken, require('./routes/audience'));
app.use('/api/campaigns', verifyToken, require('./routes/campaigns'));
app.use('/api/orders', verifyToken, require('./routes/orders'));
app.use('/api/export', require('./routes/export'));
app.use('/api/customers', verifyToken, require('./routes/customers'));
app.use('/api/communications', verifyToken, require('./routes/communications'));
app.use('/api/analytics', verifyToken, require('./routes/analytics'));
app.use('/api/copilot', verifyToken, require('./routes/copilot'));
app.use('/api/notifications', verifyToken, require('./routes/notifications'));
app.use('/api/simulator', require('./routes/simulator'));

// Webhooks don't need auth
app.use('/api/receipts', require('./routes/receipts'));

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('Connected to MongoDB Atlas');
    app.listen(PORT, () => {
      console.log(`CRM Backend running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to connect to MongoDB', err);
  });
