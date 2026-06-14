const { GoogleGenerativeAI } = require('@google/generative-ai');
const Customer = require('../models/Customer');

const apiKeys = [
  process.env.GEMINI_API_KEY,
  process.env.GEMINI_API_KEY_2,
  process.env.GEMINI_API_KEY_3
].filter(Boolean);

let currentKeyIndex = 0;

function getModel(modelName = 'gemini-2.5-flash', systemInstruction = null) {
  if (apiKeys.length === 0) throw new Error("No Gemini API keys provided");
  const genAI = new GoogleGenerativeAI(apiKeys[currentKeyIndex]);
  const config = { model: modelName };
  if (systemInstruction) config.systemInstruction = systemInstruction;
  return genAI.getGenerativeModel(config);
}

function rotateKey() {
  currentKeyIndex = (currentKeyIndex + 1) % apiKeys.length;
  console.log(`Rotated to API key index ${currentKeyIndex}`);
}

async function generateAIResponse(prompt, systemInstruction = null) {
  if (apiKeys.length === 0) throw new Error("No API keys provided");
  const currentKey = apiKeys[currentKeyIndex];

  if (currentKey.startsWith('gsk_')) {
    const messages = [];
    if (systemInstruction) {
      messages.push({ role: 'system', content: systemInstruction });
    }
    messages.push({ role: 'user', content: prompt });

    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${currentKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: messages,
        temperature: 0.1
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      let errMsg = errText;
      try {
        const parsed = JSON.parse(errText);
        if (parsed.error && parsed.error.message) errMsg = parsed.error.message;
      } catch (e) {}
      const errorObj = new Error(`Groq API error: ${res.status} - ${errMsg}`);
      errorObj.status = res.status;
      throw errorObj;
    }

    const json = await res.json();
    return json.choices[0].message.content.trim();
  } else {
    const model = getModel('gemini-2.5-flash', systemInstruction);
    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text().trim();
  }
}

async function generateChatResponse(messages, systemInstruction) {
  if (apiKeys.length === 0) throw new Error("No API keys provided");
  const currentKey = apiKeys[currentKeyIndex];

  if (currentKey.startsWith('gsk_')) {
    const messagesArray = [];
    if (systemInstruction) {
      messagesArray.push({ role: 'system', content: systemInstruction });
    }
    
    let validHistory = messages.slice(0, -1);
    for (const msg of validHistory) {
      messagesArray.push({
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: msg.content
      });
    }
    const userMessage = messages[messages.length - 1].content;
    messagesArray.push({ role: 'user', content: userMessage });

    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${currentKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: messagesArray,
        temperature: 0.2,
        max_tokens: 1000
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      let msg = errText;
      try {
        const parsed = JSON.parse(errText);
        if (parsed.error && parsed.error.message) msg = parsed.error.message;
      } catch (e) {}
      const errorObj = new Error(`Groq Chat error: ${res.status} - ${msg}`);
      errorObj.status = res.status;
      throw errorObj;
    }

    const json = await res.json();
    return json.choices[0].message.content.trim();
  } else {
    const modelName = 'gemini-2.5-flash';
    let validHistory = messages.slice(0, -1);
    if (validHistory.length > 0 && validHistory[0].role === 'assistant') {
      validHistory = validHistory.slice(1);
    }

    const history = validHistory.map(msg => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }]
    }));

    const userMessage = messages[messages.length - 1].content;
    
    const model = getModel(modelName, systemInstruction);
    const chat = model.startChat({
      history: history,
      generationConfig: {
        maxOutputTokens: 1000,
      },
    });
    const result = await chat.sendMessage(userMessage);
    return result.response.text();
  }
}

async function buildAudienceQuery(prompt) {
  const instruction = `
    You are an AI assistant that translates natural language marketer prompts into a standardized array of audience rules.
    Available fields: city, state, country, tags, lifetime_value, purchase_frequency, last_purchase_days_ago, product_category
    Operators: =, !=, >, <, >=, <=, contains
    
    The marketer wants to find specific customers. 
    Translate their prompt into a JSON array of rule objects. 
    Example for "Customers who spent > 500 and haven't purchased in 60 days":
    [
      { "field": "lifetime_value", "operator": ">", "value": 500 },
      { "field": "last_purchase_days_ago", "operator": ">", "value": 60 }
    ]
    
    Prompt: "${prompt}"
    Return ONLY a valid JSON array. Do not use markdown blocks or backticks.
  `;

  let retries = 3;
  let attemptsWithCurrentKey = 0;
  
  while (retries > 0) {
    try {
      let text = await generateAIResponse(instruction);
      
      const jsonMatch = text.match(/\[.*\]/s);
      let parsedRules = [];
      if (jsonMatch) {
        parsedRules = JSON.parse(jsonMatch[0]);
      } else {
        parsedRules = JSON.parse(text);
      }
      
      if (parsedRules && parsedRules.length > 0) {
        return parsedRules;
      } else {
        console.log('AI returned empty rules. Trying fallback parser.');
        const fallback = await fallbackRuleParser(prompt);
        if (fallback.length > 0) return fallback;
        return [];
      }
    } catch (error) {
      if (error.status === 503 && retries > 1) {
        console.log(`AI 503 error, retrying... (${retries - 1} attempts left)`);
        await new Promise(resolve => setTimeout(resolve, 2000));
        retries--;
      } else if ((error.status === 429 || error.message?.includes('429') || error.message?.includes('exhausted')) && apiKeys.length > 1 && attemptsWithCurrentKey < apiKeys.length) {
        console.log('AI Quota Exhausted (429). Rotating API key...');
        rotateKey();
        attemptsWithCurrentKey++;
      } else {
        console.log('AI API exhausted. Falling back to offline rule parser.');
        return await fallbackRuleParser(prompt);
      }
    }
  }
  return await fallbackRuleParser(prompt);
}

async function fallbackRuleParser(prompt) {
  const lower = prompt.toLowerCase().replace(/[.!?]/g, ' ').replace(/\s+/g, ' ').trim();
  const rules = [];

  const tags = ['vip', 'premium', 'regular', 'inactive', 'new customer'];
  for (const tag of tags) {
    if (lower.includes(tag)) {
      let matchedTag = tag.charAt(0).toUpperCase() + tag.slice(1);
      if (tag === 'vip') matchedTag = 'VIP';
      if (tag === 'new customer') matchedTag = 'New Customer';
      rules.push({ field: 'tags', operator: '=', value: matchedTag });
    }
  }

  const spendRegex = /(?:spend|spent|ltv|value|amount|paid).*?(above|over|greater than|more than|at least|below|under|less than|at most|>=|<=|>|<)\s*[^0-9]*(\d+)/i;
  const spendMatch = lower.match(spendRegex);
  if (spendMatch) {
    let op = spendMatch[1].trim();
    let val = Number(spendMatch[2]);
    let operator = '=';
    if (['above', 'over', 'greater than', 'more than', '>'].includes(op)) operator = '>';
    else if (['at least', '>='].includes(op)) operator = '>=';
    else if (['below', 'under', 'less than', '<'].includes(op)) operator = '<';
    else if (['at most', '<='].includes(op)) operator = '<=';
    
    rules.push({ field: 'lifetime_value', operator, value: val });
  }

  const freqRegex = /(?:visit|visits|frequency|bought|purchased|orders|ordered).*?(above|over|greater than|more than|at least|below|under|less than|at most|>=|<=|>|<)\s*[^0-9]*(\d+)/i;
  if (!lower.includes('days')) {
    const freqMatch = lower.match(freqRegex);
    if (freqMatch) {
      let op = freqMatch[1].trim();
      let val = Number(freqMatch[2]);
      let operator = '=';
      if (['above', 'over', 'greater than', 'more than', '>'].includes(op)) operator = '>';
      else if (['at least', '>='].includes(op)) operator = '>=';
      else if (['below', 'under', 'less than', '<'].includes(op)) operator = '<';
      else if (['at most', '<='].includes(op)) operator = '<=';

      rules.push({ field: 'purchase_frequency', operator, value: val });
    } else if (lower.includes('0 orders') || lower.includes('0 items') || lower.includes('ordered 0') || lower.includes('no orders') || lower.includes('no purchases') || lower.includes('zero orders')) {
      rules.push({ field: 'purchase_frequency', operator: '=', value: 0 });
    }
  }

  const daysRegex = /(?:last purchase|purchased|bought|inactive|no purchase).*?(above|over|greater than|more than|at least|below|under|less than|at most|in|for|>=|<=|>|<)\s*[^0-9]*(\d+)\s*days/i;
  const daysMatch = lower.match(daysRegex);
  if (daysMatch) {
    let op = daysMatch[1].trim();
    let val = Number(daysMatch[2]);
    let operator = '>';
    if (['in', 'for', 'above', 'over', 'greater than', 'more than', '>'].includes(op)) operator = '>';
    else if (['at least', '>='].includes(op)) operator = '>=';
    else if (['below', 'under', 'less than', '<'].includes(op)) operator = '<';
    else if (['at most', '<='].includes(op)) operator = '<=';

    rules.push({ field: 'last_purchase_days_ago', operator, value: val });
  }

  const cityMatch = lower.match(/(?:in|city|located in)\s+([a-zA-Z\s]+?)(?:\s+and|\s+who|\s+that|\s+bought|\s+with|$)/i);
  if (cityMatch && !['days', 'over', 'under', 'above', 'below'].includes(cityMatch[1].trim().toLowerCase())) {
    rules.push({ field: 'city', operator: 'contains', value: cityMatch[1].trim() });
  }

  const stateMatch = lower.match(/(?:state is|from state|state of|state)\s+([a-zA-Z\s]+?)(?:\s+and|\s+who|\s+that|\s+bought|\s+with|$)/i);
  if (stateMatch) {
    rules.push({ field: 'state', operator: 'contains', value: stateMatch[1].trim() });
  } else {
    const fromMatch = lower.match(/from\s+([a-zA-Z\s]+?)(?:\s+and|\s+who|\s+that|\s+bought|\s+with|$)/i);
    if (fromMatch && !['days', 'state', 'above', 'below', 'over', 'under'].includes(fromMatch[1].trim().toLowerCase())) {
        const loc = fromMatch[1].trim();
        const isCity = await Customer.findOne({
          city: { $regex: new RegExp('^' + loc.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&') + '$', 'i') }
        });
        if (isCity) {
          rules.push({ field: 'city', operator: 'contains', value: loc });
        } else {
          rules.push({ field: 'state', operator: 'contains', value: loc });
        }
    }
  }

  const productMatch = lower.match(/(?:bought|purchased|ordered|likes|wants|interested in)\s+(?:products?\s+|items?\s+|things?\s+)?([a-zA-Z\s]+?)(?:\s+products?|\s+items?|\s+things?|\s+and|\s+who|\s+that|$)/i);
  if (productMatch) {
    const val = productMatch[1].trim();
    if (!['days', 'over', 'under', 'above', 'below', 'vip', 'premium', 'regular', 'inactive', 'new customer'].includes(val.toLowerCase())) {
      rules.push({ field: 'product_category', operator: 'contains', value: val });
    }
  }

  const knownCategories = [
    'electronics', 'fashion', 'food', 'beauty', 'sports', 
    'books', 'home', 'clothing', 'toys', 'groceries', 
    'furniture', 'appliances', 'accessories', 'kitchen', 
    'garden', 'automotive', 'shoes', 'bags', 'health'
  ];
  for (const cat of knownCategories) {
    if (lower.includes(cat)) {
      const displayCat = cat.charAt(0).toUpperCase() + cat.slice(1);
      if (!rules.some(r => r.field === 'product_category')) {
        rules.push({ field: 'product_category', operator: 'contains', value: displayCat });
      }
    }
  }

  if (lower.includes('paid') || lower.includes('orders') || lower.includes('purchased')) {
    if (!rules.some(r => ['lifetime_value', 'purchase_frequency'].includes(r.field))) {
      rules.push({ field: 'purchase_frequency', operator: '>=', value: 1 });
    }
  }

  return rules;
}

async function draftMessage(prompt, audienceDescription) {
  const instruction = `
    You are an expert marketing copywriter. 
    The marketer is targeting this audience: "${audienceDescription}"
    They provided this instruction for the message: "${prompt}"
    Draft a short, engaging, and personalized message (SMS/WhatsApp style). 
    Use variables like {{name}} for personalization.
    Return ONLY the message text.
  `;

  let retries = 3;
  let attemptsWithCurrentKey = 0;

  while (retries > 0) {
    try {
      return await generateAIResponse(instruction);
    } catch (error) {
      if (error.status === 503 && retries > 1) {
        console.log(`AI 503 error, retrying draftMessage... (${retries - 1} attempts left)`);
        await new Promise(resolve => setTimeout(resolve, 2000));
        retries--;
      } else if ((error.status === 429 || error.message?.includes('429') || error.message?.includes('exhausted')) && apiKeys.length > 1 && attemptsWithCurrentKey < apiKeys.length) {
        console.log('AI Quota Exhausted (429) on draftMessage. Rotating API key...');
        rotateKey();
        attemptsWithCurrentKey++;
      } else {
        console.log('AI API exhausted for draftMessage. Falling back to offline text generator.');
        return fallbackMessageGenerator(prompt);
      }
    }
  }
  return fallbackMessageGenerator(prompt);
}

function fallbackMessageGenerator(prompt) {
  const lower = prompt.toLowerCase();
  
  if (lower.includes('retention') || lower.includes('miss')) {
    return "Hi {name},\n\nWe miss you! Enjoy 15% OFF your next purchase.\nUse code BACK15.";
  }
  if (lower.includes('festival') || lower.includes('sale')) {
    return "Hi {name},\n\nThe Mega Sale is LIVE! Get up to 50% OFF site-wide.\nShop now before stocks run out!";
  }
  if (lower.includes('vip') || lower.includes('loyalty')) {
    return "Hi {name},\n\nAs a valued VIP, here's your exclusive early access! Use code VIPONLY for extra perks.";
  }
  if (lower.includes('promotion')) {
    return "Hi {name},\n\nCheck out our brand new collection! Tap the link below to discover what's trending this season.";
  }
  if (lower.includes('announcement')) {
    return "Hi {name},\n\nBig news! We are thrilled to announce some exciting changes coming your way. Stay tuned for details.";
  }
  if (lower.includes('discount')) {
    return "Hi {name},\n\nFLASH SALE! Get a flat 50% OFF your entire cart. Use code FLASH50 at checkout. Hurry!";
  }
  if (lower.includes('reminder')) {
    return "Friendly reminder, {name}!\n\nYou have unredeemed loyalty points expiring soon. Don't let them go to waste.";
  }
  if (lower.includes('custom')) {
    return "Hi {name},\n\nWe just wanted to drop in and say thank you for being a valued customer. Have a great day!";
  }
  
  return "Hi {name},\n\nWe have a special offer just for you!\n\nVisit our store today to claim your reward.";
}

async function generateCustomerSummary(customer, orders) {
  const instruction = `
    You are an AI analyst for a CRM.
    Provide a concise, 2-3 sentence strategic summary of this customer.
    Customer: ${JSON.stringify(customer)}
    Orders: ${JSON.stringify(orders)}
    Focus on their value, loyalty, and potential next best action or product. Don't use markdown or bold text.
  `;

  let retries = 3;
  let attemptsWithCurrentKey = 0;

  while (retries > 0) {
    try {
      return await generateAIResponse(instruction);
    } catch (error) {
      if (error.status === 503 && retries > 1) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        retries--;
      } else if ((error.status === 429 || error.message?.includes('429') || error.message?.includes('exhausted')) && apiKeys.length > 1 && attemptsWithCurrentKey < apiKeys.length) {
        rotateKey();
        attemptsWithCurrentKey++;
      } else {
        return "Customer has shown steady engagement. Consider targeting them with VIP or loyalty promotions to increase their lifetime value.";
      }
    }
  }
  return "Customer has shown steady engagement. Consider targeting them with VIP or loyalty promotions to increase their lifetime value.";
}

module.exports = {
  buildAudienceQuery,
  draftMessage,
  generateCustomerSummary,
  generateChatResponse,
  getModel,
  rotateKey,
  apiKeys,
  fallbackRuleParser
};

