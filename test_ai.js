require('dotenv').config();
const { generateChatResponse } = require('./services/geminiService');

const messages = [{ role: 'user', content: 'Find inactive customers' }];
const systemInstruction = 'You are a helpful assistant.';

async function test() {
  try {
    const res = await generateChatResponse(messages, systemInstruction);
    console.log('Success:', res);
  } catch (err) {
    console.error('Error:', err.message, err.status);
  }
}

test();
