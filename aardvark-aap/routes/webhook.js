const express = require('express');
const { Router } = require('express');
const { slackApp } = require('../slack');
const { publishHome } = require('../slack/home');
const store = require('../store');

const router = Router();

const DEFAULT_CHANNEL = 'C09DH2G0K0Q';

// Get webhook messages
router.get('/webhook-messages', (req, res) => {
  res.json({
    messages: store.messages,
    count: store.messages.length,
  });
});

// Clear webhook messages
router.delete('/webhook-messages', (req, res) => {
  store.clear();
  res.json({ success: true, message: 'Webhook messages cleared' });
});

// Receive webhook
router.post('/webhook', express.json(), async (req, res) => {
  try {
    const { message, source = 'external-app', channel = DEFAULT_CHANNEL } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    store.add({ message, source });

    // Post to Slack channel
    if (channel) {
      try {
        await slackApp.client.chat.postMessage({
          channel,
          text: `Webhook Message from ${source}:\n${message}`,
          blocks: [
            {
              type: 'section',
              text: { type: 'mrkdwn', text: `*Webhook Message from ${source}*\n${message}` },
            },
            {
              type: 'context',
              elements: [
                { type: 'mrkdwn', text: `${new Date().toLocaleString()}` },
              ],
            },
          ],
        });
      } catch (slackError) {
        console.error('Error posting to Slack channel:', slackError);
      }
    }

    // Update App Home for active users
    try {
      const usersResult = await slackApp.client.users.list();
      const users = usersResult.members.filter(u => !u.deleted && !u.is_bot);

      for (const user of users.slice(0, 10)) {
        try {
          await publishHome(slackApp.client, user.id);
        } catch (userError) {
          console.error(`Error updating app home for user ${user.id}:`, userError);
        }
      }
    } catch (updateError) {
      console.error('Error updating app homes:', updateError);
    }

    res.json({
      success: true,
      message: 'Webhook message received and processed',
      id: store.messages[store.messages.length - 1].id,
    });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
