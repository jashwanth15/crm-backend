const express = require('express');
const router = express.Router();
const { getModel, rotateKey, apiKeys, generateCustomerSummary, fallbackRuleParser, generateChatResponse } = require('../services/geminiService');
const Customer = require('../models/Customer');
const Order = require('../models/Order');
const Campaign = require('../models/Campaign');
const Workspace = require('../models/Workspace');
const User = require('../models/User');

// Middleware to attach workspace
const getWorkspace = async (req, res, next) => {
  try {
    const workspace = await Workspace.findOne({ ownerId: req.user.id });
    if (!workspace) return res.status(404).json({ error: 'Workspace not found' });
    req.workspace = workspace;
    next();
  } catch (err) {
    res.status(500).json({ error: 'Failed to find workspace' });
  }
};

router.get('/customer-summary/:id', getWorkspace, async (req, res) => {
  try {
    const customer = await Customer.findOne({ _id: req.params.id, workspaceId: req.workspace._id }).lean();
    if (!customer) return res.status(404).json({ error: 'Customer not found' });
    
    const orders = await Order.find({ customerId: customer._id }).lean();
    
    const summary = await generateCustomerSummary(customer, orders);
    res.json({ summary });
  } catch (err) {
    console.error('Error generating summary:', err);
    res.status(500).json({ error: 'Failed to generate summary' });
  }
});

router.post('/chat', getWorkspace, async (req, res) => {
  const { messages } = req.body;
  const workspaceId = req.workspace._id;

  // Local check for affirmative responses to navigate user to previous action suggestion
  if (messages && Array.isArray(messages) && messages.length > 0) {
    const userMessage = messages[messages.length - 1].content || '';
    const lower = userMessage.toLowerCase().trim().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g,"");
    const affirmations = ['yes', 'yeah', 'yup', 'y', 'sure', 'ok', 'okay', 'yep', 'indeed', 'absolutely', 'go ahead', 'yes please', 'please', 'go'];
    
    if (affirmations.includes(lower) && messages.length >= 2) {
      let lastAssistantActionMsg = null;
      for (let i = messages.length - 2; i >= 0; i--) {
        if (messages[i].role === 'assistant' && messages[i].action) {
          lastAssistantActionMsg = messages[i];
          break;
        }
      }
      
      if (lastAssistantActionMsg) {
        return res.json({
          content: `Sure! Click the button below to go to ${lastAssistantActionMsg.action.label.replace('Go to ', '')}:`,
          action: lastAssistantActionMsg.action
        });
      }
    }
  }

  // Local check for simple greetings to respond instantly
  if (messages && Array.isArray(messages) && messages.length > 0) {
    const userMessage = messages[messages.length - 1].content || '';
    const lower = userMessage.toLowerCase().trim();
    if (['hi', 'hello', 'hey', 'greetings', 'yo'].includes(lower)) {
      return res.json({
        content: "Hello! I am Xeno AI. How can I help you today? 👋\n\nI can help you build audiences, analyze customer data, or launch campaigns. For example, try asking: *'Show customers from Port Ian who bought Fashion products.'*",
        action: { label: "Go to Audience Builder", route: "create-audience-ai" }
      });
    }
  }

  try {
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Messages array is required.' });
    }

    // Fetch Database Context
    const customers = await Customer.find({ workspaceId }).lean();
    const orders = await Order.find({ workspaceId }).lean();
    const campaigns = await Campaign.find({ workspaceId }).lean();
    const user = await User.findById(req.user.id).lean();

    // Calculate aggregated statistics
    const totalCustomers = customers.length;
    const totalOrders = orders.length;
    const totalRevenue = orders.reduce((sum, o) => sum + (o.amount || 0), 0);
    const totalCampaignRevenue = campaigns.reduce((sum, c) => sum + (c.revenue || 0), 0);
    const totalCampaignConversions = campaigns.reduce((sum, c) => sum + (c.conversions || 0), 0);
    
    const cityCounts = {};
    const stateCounts = {};
    const tagCounts = {};
    const categoryCounts = {};
    
    for (const c of customers) {
      if (c.city) cityCounts[c.city] = (cityCounts[c.city] || 0) + 1;
      if (c.state) stateCounts[c.state] = (stateCounts[c.state] || 0) + 1;
      if (c.tags && Array.isArray(c.tags)) {
        for (const t of c.tags) {
          tagCounts[t] = (tagCounts[t] || 0) + 1;
        }
      }
    }
    
    for (const o of orders) {
      if (o.category) categoryCounts[o.category] = (categoryCounts[o.category] || 0) + 1;
    }
       const topCities = Object.entries(cityCounts)
      .sort((a, b) => b[1] - a[1])
      .reduce((obj, [k, v]) => ({ ...obj, [k]: v }), {});
      
    const topStates = Object.entries(stateCounts)
      .sort((a, b) => b[1] - a[1])
      .reduce((obj, [k, v]) => ({ ...obj, [k]: v }), {});

    const dbContext = {
      user_info: {
        name: user ? user.name : 'Unknown User',
        email: user ? user.email : 'Unknown Email'
      },
      database_summary: {
        total_customers: totalCustomers,
        total_orders: totalOrders,
        total_revenue_inr: totalRevenue,
        total_campaign_revenue_inr: totalCampaignRevenue,
        total_campaign_conversions: totalCampaignConversions,
        average_order_value_inr: totalOrders > 0 ? (totalRevenue / totalOrders) : 0,
        cities_distribution: topCities,
        states_distribution: topStates,
        tags_distribution: tagCounts,
        order_categories_distribution: categoryCounts
      },
      customer_schema_sample: customers.slice(0, 3).map(c => ({
        id: c._id,
        name: c.name,
        email: c.email,
        city: c.city,
        state: c.state,
        tags: c.tags,
        lifetime_value: c.lifetime_value
      })),
      campaigns: campaigns.map(c => ({ 
        name: c.name, 
        status: c.status,
        channel: c.channel,
        revenue_inr: c.revenue || 0,
        conversions: c.conversions || 0
      }))
    };

    const systemInstruction = `You are Xeno AI Copilot, a highly intelligent marketing assistant for a CRM platform.
Your job is to answer ANY question the user has, including general knowledge, marketing advice, or complex data analysis based on the provided database context.

Rules:
1. DIRECT ANSWERS ONLY: Reply directly with the answer without extra matter, filler text, or conversational fluff. Be extremely concise. Do NOT say things like "Unfortunately", "I don't see", or "However". Just provide the number or facts.
2. Always base data answers on the provided context (cities_distribution, states_distribution, tags_distribution, etc). If they ask for their name, use user_info.name. If they ask about revenue, use the exact numbers provided.
3. If they ask a general question that is NOT in the database, answer it intelligently using your general knowledge, but still keep it as direct and concise as possible.`;

DATABASE CONTEXT:
${JSON.stringify(dbContext)}

ACTIONS:
If your response naturally leads to an action in the app (like creating a campaign, building an audience, viewing analytics, or going to settings), you MUST output a JSON object on the very last line of your response (and nothing after it) in this format:
{"action": {"label": "Button Text", "route": "route_name"}}
Valid routes: 'campaigns', 'create-campaign', 'audience', 'create-audience-ai', 'analytics', 'settings'.
Do not use markdown blocks for the JSON on the last line, just the raw JSON.`;

    let retries = 3;
    let attemptsWithCurrentKey = 0;
    let responseText = null;

    while (retries > 0) {
      try {
        responseText = await generateChatResponse(messages, systemInstruction);
        break; // Success
      } catch (err) {
        if (err.status === 503 && retries > 1) {
          console.log(`Copilot 503 error, retrying... (${retries - 1} attempts left)`);
          await new Promise(resolve => setTimeout(resolve, 2000));
          retries--;
        } else if ((err.status === 429 || err.message?.includes('429') || err.message?.includes('exhausted')) && apiKeys.length > 1 && attemptsWithCurrentKey < apiKeys.length) {
          console.log('Copilot Quota Exhausted (429). Rotating API key...');
          rotateKey();
          attemptsWithCurrentKey++;
        } else {
          throw err;
        }
      }
    }

    if (!responseText) {
      throw new Error('Failed to generate response after retries');
    }

    // Parse out potential action JSON at the end
    let content = responseText;
    let action = null;

    const lines = responseText.trim().split('\n');
    const lastLine = lines[lines.length - 1];

    try {
      if (lastLine.startsWith('{') && lastLine.endsWith('}')) {
        const parsed = JSON.parse(lastLine);
        if (parsed.action) {
          action = parsed.action;
          content = lines.slice(0, -1).join('\n').trim();
        }
      }
    } catch (e) {
      // Ignore JSON parse errors
    }

    // Enrich response with live customer list if it's a customer query
    const userMessage = messages[messages.length - 1].content;
    const userMessageLower = userMessage.toLowerCase();
    const isSearchQuery = userMessageLower.includes('show') || userMessageLower.includes('list') || userMessageLower.includes('find') || userMessageLower.includes('segment') || userMessageLower.includes('who bought') || userMessageLower.includes('who spent');
    
    if (isSearchQuery) {
      try {
        const parsedRules = await fallbackRuleParser(userMessage);
        if (parsedRules && parsedRules.length > 0) {
          const { buildMongoQueryFromRules } = require('./audience');
          const mongoQuery = await buildMongoQueryFromRules(parsedRules, workspaceId);
          const matchingCustomers = await Customer.find(mongoQuery).lean();
          
          if (matchingCustomers.length > 0) {
            const catRule = parsedRules.find(r => r.field === 'product_category');
            let extraContent = '';
            
            if (catRule) {
              const cat = catRule.value;
              const cIds = matchingCustomers.map(c => c._id);
              const matchingOrders = await Order.find({
                workspaceId,
                customerId: { $in: cIds },
                category: { $regex: new RegExp('^' + cat.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&') + '$', 'i') }
              }).lean();
              
              if (matchingOrders.length > 0) {
                const grouped = {};
                for (const order of matchingOrders) {
                  const cIdStr = order.customerId.toString();
                  if (!grouped[cIdStr]) {
                    const custDoc = matchingCustomers.find(c => c._id.toString() === cIdStr);
                    grouped[cIdStr] = {
                      name: custDoc ? custDoc.name : 'Unknown',
                      email: custDoc ? custDoc.email : '',
                      city: custDoc ? custDoc.city : '',
                      orders: []
                    };
                  }
                  grouped[cIdStr].orders.push(order);
                }
                
                extraContent = `\n\nI queried the database and found **${matchingOrders.length}** matching ${cat.charAt(0).toUpperCase() + cat.slice(1)} orders:\n`;
                for (const key in grouped) {
                  const info = grouped[key];
                  extraContent += `* **${info.name}** (${info.email}) - ${info.city || ''}\n`;
                  extraContent += `  * Orders: ${info.orders.map(o => `${o.productName} (₹${o.amount})`).join(', ')}\n`;
                }
              }
            }
            
            if (!extraContent) {
              extraContent = `\n\nI queried the database and found **${matchingCustomers.length}** matching customers:\n\n`;
              for (const c of matchingCustomers.slice(0, 10)) {
                extraContent += `* **${c.name}** (${c.email}) - ${c.city || c.state || 'Unknown'}\n`;
              }
              if (matchingCustomers.length > 10) {
                extraContent += `\n*...and ${matchingCustomers.length - 10} more.*`;
              }
            }
            
            content += extraContent;
            action = { label: "Go to Audience Builder", route: "create-audience-ai" };
          }
        }
      } catch (err) {
        console.error('Failed to enrich customer search query:', err);
      }
    }

    res.json({ content, action });
  } catch (err) {
    console.error('Copilot Chat Error:', err);
    
    try {
      const userMessage = messages[messages.length - 1].content;
      const lower = userMessage.toLowerCase().trim();
      
      // Friendly offline greetings check
      if (['hi', 'hello', 'hey', 'greetings', 'yo'].includes(lower)) {
        return res.json({
          content: "Hello! I am Xeno AI. How can I help you today? 👋\n\nI can help you build audiences, analyze customer data, or launch campaigns. For example, try asking: *'Show customers from Port Ian who bought Fashion products.'*",
          action: { label: "Go to Audience Builder", route: "create-audience-ai" }
        });
      }

      // Offline help & guide responder
      if (lower.includes('campaign') || lower.includes('objective') || lower.includes('message')) {
        return res.json({
          content: "To create and launch a campaign:\n\n1. Click on **Campaigns** in the sidebar or click the **Create Campaign** quick action on the dashboard.\n2. Click the **Create Campaign** button in the top right.\n3. Enter the campaign details (Name, Objective, Audience, Channel, Message body).\n4. Click **Launch Campaign** to send it immediately via the simulator, or **Save Draft** to edit it later.\n\nWould you like me to take you to the campaign creator?",
          action: { label: "Create Campaign", route: "create-campaign" }
        });
      }
      if (lower.includes('audience') || lower.includes('segment') || lower.includes('rule') || lower.includes('builder')) {
        return res.json({
          content: "To build a customer audience segment:\n\n1. Click on **Audiences** in the sidebar.\n2. You can use the **Manual Builder** to define rules (like city, total spend, tags) OR use the **AI Builder** to describe your audience in plain English.\n3. Click **Preview Audience** to see matching customers.\n4. Enter a name and click **Save Audience**.\n\nWould you like me to take you to the Audience Builder?",
          action: { label: "Go to Audience Builder", route: "create-audience-ai" }
        });
      }
      if (lower.includes('customer') || lower.includes('people') || lower.includes('user')) {
        return res.json({
          content: "To view or manage your customers:\n\n1. Click on **Customers** in the sidebar to see the customer database.\n2. You can search, filter, and view individual customer profiles (timeline, spent stats, campaigns received, etc.).\n3. To add a new customer, click the **Add Customer** button on the customers page.\n\nWould you like me to take you to the Customers list?",
          action: { label: "Go to Customers", route: "customers" }
        });
      }
      if (lower.includes('analytics') || lower.includes('report') || lower.includes('stats') || lower.includes('revenue') || lower.includes('chart') || lower.includes('graph')) {
        return res.json({
          content: "To view your performance metrics and reports:\n\n1. Open the **Analytics** view from the sidebar.\n2. You can check the Revenue Overview chart, average order value, conversion rates, and performance across channels (Email, WhatsApp, SMS, RCS).\n3. Use the date range filter in the top right to analyze specific timeframes.\n\nWould you like me to take you to the Analytics Dashboard?",
          action: { label: "Go to Analytics", route: "analytics" }
        });
      }
      if (lower.includes('setting') || lower.includes('profile') || lower.includes('theme') || lower.includes('dark') || lower.includes('light')) {
        if (lower.includes('how') || lower.includes('where') || lower.includes('change') || lower.includes('edit')) {
          return res.json({
            content: "To manage your account settings or change themes:\n\n1. Click on the **Settings** icon at the bottom of the sidebar.\n2. You can update your business name, notification preferences, or switch between Light and Dark themes.\n\nWould you like me to take you to Settings?",
            action: { label: "Go to Settings", route: "settings" }
          });
        }
      }
      if (lower.includes('order') || lower.includes('purchase') || lower.includes('product') || lower.includes('buy') || lower.includes('bought')) {
        if (lower.includes('how') || lower.includes('where') || lower.includes('create') || lower.includes('add') || lower.includes('view') || lower.includes('track')) {
          return res.json({
            content: "To view and manage your orders:\n\n1. Click on **Orders** in the sidebar.\n2. You can search orders by product name, category, status, date, or customer details.\n3. Use the **Add Order** action to record new orders.\n\nWould you like me to take you to the Orders list?",
            action: { label: "Go to Orders", route: "orders" }
          });
        }
      }
      // General question fallback
      const isQuestion = lower.includes('how') || lower.includes('what') || lower.includes('can') || lower.includes('why') || lower.includes('help') || lower.includes('explain') || lower.includes('guide');
      if (isQuestion) {
        return res.json({
          content: "I am currently running in offline fallback mode because my AI brain reached its API limit! 😅\n\nHowever, I can guide you through the CRM platform's features. Please ask me about:\n* **How to create a campaign**\n* **How to build an audience**\n* **How to search customers or orders**\n* **How to view analytics or change settings**\n\nOr click below to head straight to the Audience Builder!",
          action: { label: "Go to Audience Builder", route: "create-audience-ai" }
        });
      }

      // Check if it is a delete/remove query
      const isDeleteQuery = lower.includes('delete') || lower.includes('remove') || lower.includes('clear');
      if (isDeleteQuery) {
        const parsedRules = await fallbackRuleParser(userMessage);
        const prefix = "I cannot perform delete or modification operations directly from the chat. ";
        if (parsedRules && parsedRules.length > 0) {
          const { buildMongoQueryFromRules } = require('./audience');
          const mongoQuery = await buildMongoQueryFromRules(parsedRules, workspaceId);
          const matchingCustomers = await Customer.find(mongoQuery).lean();
          
          if (matchingCustomers.length > 0) {
            let reply = `${prefix}However, I found **${matchingCustomers.length}** customers matching your criteria:\n\n`;
            for (const c of matchingCustomers.slice(0, 10)) {
              reply += `* **${c.name}** (${c.email}) - ${c.city || c.state || 'Unknown'}\n`;
            }
            if (matchingCustomers.length > 10) {
              reply += `\n*...and ${matchingCustomers.length - 10} more.*`;
            }
            reply += `\n\nYou can use the Audience Builder to review and target them!`;
            return res.json({
              content: reply,
              action: { label: "Go to Audience Builder", route: "create-audience-ai" }
            });
          }
        }
        return res.json({
          content: "I cannot perform delete or modification operations directly from the chat. However, you can segment and manage your customers in the Audience Builder!",
          action: { label: "Go to Audience Builder", route: "create-audience-ai" }
        });
      }

      // Try running the query via robust fallback rule parser
      const parsedRules = await fallbackRuleParser(userMessage);
      
      if (parsedRules && parsedRules.length > 0) {
        const { buildMongoQueryFromRules } = require('./audience');
        const mongoQuery = await buildMongoQueryFromRules(parsedRules, workspaceId);
        
        // Find matching customers
        const matchingCustomers = await Customer.find(mongoQuery).lean();
        
        if (matchingCustomers.length > 0) {
          const catRule = parsedRules.find(r => r.field === 'product_category');
          let reply = '';
          
          if (catRule) {
            const cat = catRule.value;
            const cIds = matchingCustomers.map(c => c._id);
            const matchingOrders = await Order.find({
              workspaceId,
              customerId: { $in: cIds },
              category: { $regex: new RegExp('^' + cat.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&') + '$', 'i') }
            }).lean();
            
            if (matchingOrders.length > 0) {
              const grouped = {};
              for (const order of matchingOrders) {
                const cIdStr = order.customerId.toString();
                if (!grouped[cIdStr]) {
                  const custDoc = matchingCustomers.find(c => c._id.toString() === cIdStr);
                  grouped[cIdStr] = {
                    name: custDoc ? custDoc.name : 'Unknown',
                    email: custDoc ? custDoc.email : '',
                    city: custDoc ? custDoc.city : '',
                    orders: []
                  };
                }
                grouped[cIdStr].orders.push(order);
              }
              
              reply = `I found **${matchingOrders.length}** ${cat.charAt(0).toUpperCase() + cat.slice(1)} orders.\n\nHere are the customer details:\n`;
              for (const key in grouped) {
                const info = grouped[key];
                reply += `* **${info.name}** (${info.email}) - ${info.city || ''}\n`;
                reply += `  * Orders: ${info.orders.map(o => `${o.productName} (₹${o.amount})`).join(', ')}\n`;
              }
            }
          }
          
          if (!reply) {
            reply = `I found **${matchingCustomers.length}** matching customers:\n\n`;
            for (const c of matchingCustomers.slice(0, 10)) {
              reply += `* **${c.name}** (${c.email}) - ${c.city || c.state || 'Unknown'}\n`;
            }
            if (matchingCustomers.length > 10) {
              reply += `\n*...and ${matchingCustomers.length - 10} more.*`;
            }
          }
          
          return res.json({ 
            content: reply,
            action: { label: "Go to Audience Builder", route: "create-audience-ai" }
          });
        }
      }

      // Secondary fallback (original regex logic)
      let loc = null;
      let cat = null;
      
      const match1 = lower.match(/(?:from|in|located in)\s+([a-z\s]+?)\s+(?:who bought|who ordered|interested in|ordered|bought|like|likes)\s+([a-z\s]+?)(?:\s+products?|\s+items?|\s+things?|$)/i);
      const match2 = lower.match(/(?:who bought|who ordered|interested in|ordered|bought|like|likes)\s+([a-z\s]+?)(?:\s+products?|\s+items?|\s+things?)?\s+(?:from|in|located in)\s+([a-z\s]+?)\.?$/i);
      
      if (match1) {
        loc = match1[1].trim();
        cat = match1[2].trim();
      } else if (match2) {
        cat = match2[1].trim();
        loc = match2[2].trim();
      }
      
      if (loc && cat) {
        const matchingCustomers = await Customer.find({
          workspaceId,
          $or: [
            { city: { $regex: new RegExp('^' + loc.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&') + '$', 'i') } },
            { state: { $regex: new RegExp('^' + loc.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&') + '$', 'i') } }
          ]
        }).lean();
        
        if (matchingCustomers.length > 0) {
          const cIds = matchingCustomers.map(c => c._id);
          const matchingOrders = await Order.find({
            workspaceId,
            customerId: { $in: cIds },
            category: { $regex: new RegExp('^' + cat.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&') + '$', 'i') }
          }).lean();
          
          if (matchingOrders.length > 0) {
            const grouped = {};
            for (const order of matchingOrders) {
              const cIdStr = order.customerId.toString();
              if (!grouped[cIdStr]) {
                const custDoc = matchingCustomers.find(c => c._id.toString() === cIdStr);
                grouped[cIdStr] = {
                  name: custDoc ? custDoc.name : 'Unknown',
                  email: custDoc ? custDoc.email : '',
                  city: custDoc ? custDoc.city : '',
                  orders: []
                };
              }
              grouped[cIdStr].orders.push(order);
            }
            
            let reply = `I found **${matchingOrders.length}** ${cat.charAt(0).toUpperCase() + cat.slice(1)} orders from **${loc.charAt(0).toUpperCase() + loc.slice(1)}**.\n\nHere are the customer details:\n`;
            for (const key in grouped) {
              const info = grouped[key];
              reply += `* **${info.name}** (${info.email}) - ${info.city}\n`;
              reply += `  * Orders: ${info.orders.map(o => `${o.productName} (₹${o.amount})`).join(', ')}\n`;
            }
            
            return res.json({ 
              content: reply,
              action: { label: "Go to Audience Builder", route: "create-audience-ai" }
            });
          }
        }
      }
    } catch (fallbackErr) {
      console.error('Offline copilot fallback failed:', fallbackErr);
    }

    // Default friendly fallback
    res.json({ 
      content: "Ah, my AI brain has temporarily reached its API limit for today! 😅\n\nI can't answer complex data questions right now, but you can still use my offline features! Click below to jump straight to the Audience Builder:", 
      action: { label: "Go to Audience Builder", route: "create-audience-ai" } 
    });
  }
});

module.exports = router;
