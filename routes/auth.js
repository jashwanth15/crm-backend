const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { verifyToken, JWT_SECRET } = require('../middleware/auth');
const User = require('../models/User');
const Customer = require('../models/Customer');
const Order = require('../models/Order');
const Campaign = require('../models/Campaign');

// POST /api/auth/signup
router.post('/signup', async (req, res) => {
  const { name, email, password } = req.body;

  try {
    const existingUser = await User.findOne({ email });
    if (existingUser) return res.status(400).json({ error: 'Email already exists' });

    const passwordHash = await bcrypt.hash(password, 10);
    const user = new User({ name, email, passwordHash });
    await user.save();

    const token = jwt.sign({ id: user._id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ token, user: { id: user._id, name: user.name, email: user.email } });
  } catch (err) {
    res.status(500).json({ error: 'Signup failed' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ error: 'Invalid credentials' });

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) return res.status(400).json({ error: 'Invalid credentials' });

    const token = jwt.sign({ id: user._id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user._id, name: user.name, email: user.email } });
  } catch (err) {
    res.status(500).json({ error: 'Login failed' });
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  res.json({ message: 'Logged out successfully' });
});

// POST /api/auth/forgot-password
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;

  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const token = crypto.randomBytes(20).toString('hex');
    user.resetPasswordToken = token;
    user.resetPasswordExpires = Date.now() + 3600000; // 1 hour
    await user.save();

    const resetLink = `http://localhost:5173/reset-password?token=${token}`;

    const mailOptions = {
      to: user.email,
      from: 'passwordreset@xeno.com',
      subject: 'XENO CRM Password Reset',
      text: `You are receiving this because you (or someone else) have requested the reset of the password for your account.\n\n` +
        `Please click on the following link, or paste this into your browser to complete the process:\n\n` +
        `${resetLink}\n\n` +
        `If you did not request this, please ignore this email and your password will remain unchanged.\n`
    };

    let previewUrl = null;
    try {
      const testAccount = await nodemailer.createTestAccount();
      const transporter = nodemailer.createTransport({
        host: testAccount.host,
        port: testAccount.port,
        secure: testAccount.secure,
        auth: {
          user: testAccount.user,
          pass: testAccount.pass
        }
      });
      const info = await transporter.sendMail(mailOptions);
      previewUrl = nodemailer.getTestMessageUrl(info);
      console.log('----------------------------------------------------');
      console.log('PASSWORD RESET EMAIL SENT (ETHEREAL EMAIL PREVIEW):');
      console.log(`To: ${user.email}`);
      console.log(`Reset Link: ${resetLink}`);
      console.log(`Preview Inbox URL: ${previewUrl}`);
      console.log('----------------------------------------------------');
    } catch (mailErr) {
      console.log('----------------------------------------------------');
      console.log('PASSWORD RESET EMAIL SIMULATED (OFFLINE FALLBACK):');
      console.log(`To: ${user.email}`);
      console.log(`Reset Link: ${resetLink}`);
      console.log(`Reason: SMTP service unavailable (${mailErr.message})`);
      console.log('----------------------------------------------------');
      // Fallback preview URL points to reset link directly for testing
      previewUrl = resetLink;
    }

    res.json({ 
      message: 'Reset link simulated and sent!', 
      previewUrl: previewUrl 
    });
  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({ error: 'Failed to process forgot password request' });
  }
});

// POST /api/auth/reset-password
router.post('/reset-password', async (req, res) => {
  const { token, password } = req.body;

  try {
    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({ error: 'Password reset token is invalid or has expired' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    user.passwordHash = passwordHash;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    res.json({ message: 'Password has been reset successfully' });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

// GET /api/auth/profile
router.get('/profile', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-passwordHash');
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// PUT /api/auth/profile
router.put('/profile', verifyToken, async (req, res) => {
  const { name, email, phone, jobTitle, profilePhoto } = req.body;
  try {
    const user = await User.findByIdAndUpdate(req.user.id, {
      name, email, phone, jobTitle, profilePhoto
    }, { new: true }).select('-passwordHash');
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// PUT /api/auth/password
router.put('/password', verifyToken, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const isMatch = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isMatch) return res.status(400).json({ error: 'Incorrect current password' });

    const passwordHash = await bcrypt.hash(newPassword, 10);
    user.passwordHash = passwordHash;
    await user.save();

    res.json({ message: 'Password updated successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update password' });
  }
});

// POST /api/auth/google (MOCK OAUTH)
router.post('/google', async (req, res) => {
  try {
    let user = await User.findOne({ email: 'google.user@example.com' });
    if (!user) {
      const passwordHash = await bcrypt.hash('googleMockPassword123!', 10);
      user = new User({
        name: 'Google User',
        email: 'google.user@example.com',
        passwordHash,
        role: 'admin'
      });
      await user.save();
    }
    const token = jwt.sign({ id: user._id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user._id, name: user.name, email: user.email } });
  } catch (err) {
    res.status(500).json({ error: 'Google Login failed' });
  }
});

module.exports = router;
