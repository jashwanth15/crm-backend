require('dotenv').config();
const mongoose = require('mongoose');
const { generateChatResponse } = require('./services/geminiService');

async function test() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to DB');
  
  const messages = [{ role: 'user', content: 'Find inactive customers' }];
  
  // mock dbContext
  const dbContext = {
    user_info: { name: 'Test', email: 'test@example.com' },
    database_summary: { total_customers: 10, total_orders: 5, total_revenue_inr: 1000 },
    searched_data: null,
    customer_schema_sample: [],
    campaigns: []
  };

  const systemInstruction = `You are Xeno AI Copilot...
DATABASE CONTEXT:
${JSON.stringify(dbContext)}
ACTIONS: ...`;

  try {
    const res = await generateChatResponse(messages, systemInstruction);
    console.log('Success response:', res);
  } catch (err) {
    console.error('Error in chat:', err);
  }
  process.exit(0);
}

test();
