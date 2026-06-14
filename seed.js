require('dotenv').config();
const mongoose = require('mongoose');
const Customer = require('./models/Customer');
const Order = require('./models/Order');

const MONGODB_URI = process.env.MONGODB_URI;

const mockCustomers = [
  { name: 'Alice Smith', email: 'alice@example.com', phone: '+1234567890', lifetime_value: 150 },
  { name: 'Bob Johnson', email: 'bob@example.com', phone: '+1987654321', lifetime_value: 300 },
  { name: 'Charlie Brown', email: 'charlie@example.com', phone: '+1122334455', lifetime_value: 50 },
  { name: 'Diana Prince', email: 'diana@example.com', phone: '+1555666777', lifetime_value: 500 },
];

async function seedDatabase() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB. Clearing old data...');
    
    await Customer.deleteMany({});
    await Order.deleteMany({});
    
    console.log('Inserting mock customers...');
    const insertedCustomers = await Customer.insertMany(mockCustomers);
    
    console.log('Inserting mock orders...');
    const orders = [
      { customer_id: insertedCustomers[0]._id, total_amount: 100, items: [{name: 'Shoes', price: 100, quantity: 1}] },
      { customer_id: insertedCustomers[0]._id, total_amount: 50, items: [{name: 'T-Shirt', price: 50, quantity: 1}] },
      { customer_id: insertedCustomers[1]._id, total_amount: 300, items: [{name: 'Watch', price: 300, quantity: 1}] },
      { customer_id: insertedCustomers[2]._id, total_amount: 50, items: [{name: 'Coffee Mug', price: 50, quantity: 1}] },
      { customer_id: insertedCustomers[3]._id, total_amount: 500, items: [{name: 'Laptop Bag', price: 500, quantity: 1}] },
    ];
    await Order.insertMany(orders);
    
    console.log('Database seeded successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Error seeding database:', error);
    process.exit(1);
  }
}

seedDatabase();
