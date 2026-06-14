require('dotenv').config();
const mongoose = require('mongoose');
const Customer = require('./models/Customer');

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  const c = await Customer.find({tags: { $regex: '^Premium$', $options: 'i' }});
  console.log(c.length);
  process.exit(0);
}
run();
