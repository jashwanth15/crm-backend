const express = require('express');
const router = express.Router();

const CRM_WEBHOOK_URL = `http://localhost:${process.env.PORT || 3000}/api/receipts`;

// Helper to pick random status
function getRandomStatus() {
  const rand = Math.random();
  if (rand < 0.1) return 'FAILED';
  if (rand < 0.6) return 'DELIVERED';
  if (rand < 0.8) return 'OPENED';
  return 'CLICKED';
}

const campaignProgress = {};

router.post('/send', (req, res) => {
  const { campaign_id, communications } = req.body;
  if (!communications || !Array.isArray(communications)) {
    return res.status(400).json({ error: 'Invalid payload' });
  }

  console.log(`[Simulator] Received request to send ${communications.length} messages.`);
  res.status(202).json({ message: 'Messages queued for delivery simulation' });

  let totalWebhooks = 0;
  const webhooksToSchedule = [];

  communications.forEach(comm => {
    // Determine the final fate of this message
    const rand = Math.random();
    let finalStatus = 'CLICKED';
    if (rand < 0.1) finalStatus = 'FAILED';
    else if (rand < 0.5) finalStatus = 'OPENED';

    const sequence = ['SENT'];
    if (finalStatus !== 'FAILED') {
      sequence.push('DELIVERED');
      if (finalStatus === 'OPENED' || finalStatus === 'CLICKED') sequence.push('OPENED');
      if (finalStatus === 'CLICKED') sequence.push('CLICKED');
    } else {
      sequence.push('FAILED');
    }

    totalWebhooks += sequence.length;

    let cumulativeDelay = Math.floor(Math.random() * 2000) + 1000; // 1-3 seconds to start
    sequence.forEach((status) => {
      webhooksToSchedule.push({
        commId: comm.id,
        status: status,
        delay: cumulativeDelay
      });
      cumulativeDelay += Math.floor(Math.random() * 3000) + 2000; // 2-5 seconds between steps
    });
  });

  if (campaign_id) {
    campaignProgress[campaign_id] = totalWebhooks;
  }

  webhooksToSchedule.forEach(item => {
    setTimeout(async () => {
      const payload = {
        communication_id: item.commId,
        status: item.status,
        timestamp: new Date()
      };
      console.log(`[Simulator] Sending webhook for ${item.commId} -> ${item.status}`);
      try {
        await fetch(CRM_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      } catch (err) {
        console.error('[Simulator] Webhook delivery failed:', err.message);
      }

      if (campaign_id) {
        campaignProgress[campaign_id]--;
        if (campaignProgress[campaign_id] === 0) {
          console.log(`[Simulator] All webhooks sent for campaign ${campaign_id}. Notifying backend.`);
          delete campaignProgress[campaign_id];
          try {
            await fetch(`${CRM_WEBHOOK_URL}/campaign-complete`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ campaign_id })
            });
          } catch (err) {
            console.error('[Simulator] Failed to notify backend of campaign completion:', err.message);
          }
        }
      }
    }, item.delay);
  });
});

module.exports = router;
