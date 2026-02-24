const express = require('express');
const { App, ExpressReceiver } = require('@slack/bolt');
const axios = require('axios');

const port = process.env.PORT || 80;

// Prevent Bolt auth errors from crashing the process
process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection (non-fatal):', err.message || err);
});

// Create our own Express app — routes registered here run BEFORE Bolt's middleware
// NOTE: Do NOT add a global express.json() here — it would consume the raw body
// that Bolt needs for Slack signature verification on /slack/events.
const expressApp = express();

// Store for webhook messages
const webhookMessages = [];
const startTime = Date.now();

// Health check endpoint — registered first so ALB can reach it
expressApp.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    webhookMessages: webhookMessages.length
  });
});

// Get webhook messages endpoint
expressApp.get('/webhook-messages', (req, res) => {
  res.json({
    messages: webhookMessages,
    count: webhookMessages.length
  });
});

// Clear webhook messages endpoint
expressApp.delete('/webhook-messages', (req, res) => {
  webhookMessages.length = 0;
  res.json({ success: true, message: 'Webhook messages cleared' });
});

// Create Bolt receiver (its routes are mounted after ours)
const receiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});

// Slack App Configuration
const slackApp = new App({
  token: process.env.SLACK_BOT_TOKEN,
  receiver,
  clientId: process.env.SLACK_CLIENT_ID,
  clientSecret: process.env.SLACK_CLIENT_SECRET,
});

// Build App Home blocks
function buildHomeBlocks() {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayMessages = webhookMessages.filter(m => new Date(m.timestamp) >= todayStart);

  const uptimeSecs = Math.floor((Date.now() - startTime) / 1000);
  const days = Math.floor(uptimeSecs / 86400);
  const hours = Math.floor((uptimeSecs % 86400) / 3600);
  const minutes = Math.floor((uptimeSecs % 3600) / 60);
  const uptimeStr = days > 0
    ? `${days}d ${hours}h ${minutes}m`
    : hours > 0
      ? `${hours}h ${minutes}m`
      : `${minutes}m`;

  // --- Today ---
  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: 'Today' },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `:large_green_circle: *Running* for ${uptimeStr}` },
        { type: 'mrkdwn', text: `*Messages today:* ${todayMessages.length}` },
      ],
    },
  ];

  // Sources breakdown for today
  const sourceCounts = {};
  for (const msg of todayMessages) {
    sourceCounts[msg.source] = (sourceCounts[msg.source] || 0) + 1;
  }
  const sourceEntries = Object.entries(sourceCounts);
  if (sourceEntries.length > 0) {
    const sourceText = sourceEntries
      .sort((a, b) => b[1] - a[1])
      .map(([source, count]) => `${source}: ${count}`)
      .join('  |  ');
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: sourceText }],
    });
  }

  // --- Log ---
  blocks.push(
    { type: 'divider' },
    {
      type: 'header',
      text: { type: 'plain_text', text: 'Log' },
    }
  );

  if (webhookMessages.length === 0) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: '_No messages yet._' },
    });
  } else {
    const recent = webhookMessages.slice(-5).reverse();
    for (const msg of recent) {
      const ts = Math.floor(new Date(msg.timestamp).getTime() / 1000);
      blocks.push(
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*${msg.source}*\n${msg.message}`,
          },
        },
        {
          type: 'context',
          elements: [
            { type: 'mrkdwn', text: `<!date^${ts}^{date_short_pretty} at {time}|${msg.timestamp}>` },
          ],
        }
      );
    }
    if (webhookMessages.length > 5) {
      blocks.push({
        type: 'context',
        elements: [
          { type: 'mrkdwn', text: `_${webhookMessages.length - 5} older messages not shown_` },
        ],
      });
    }
  }

  // --- Config ---
  blocks.push(
    { type: 'divider' },
    {
      type: 'header',
      text: { type: 'plain_text', text: 'Config' },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Webhook endpoint:*\n\`POST /webhook\`` },
        { type: 'mrkdwn', text: `*Default channel:*\n<#C09DH2G0K0Q>` },
      ],
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*Payload format:*\n```{\n  "message": "Build passed",\n  "source": "ci-pipeline",\n  "channel": "#deployments"\n}```',
      },
    },
    {
      type: 'context',
      elements: [
        { type: 'mrkdwn', text: '`channel` is optional — omit it to log without posting to a channel' },
      ],
    }
  );

  return blocks;
}

// Publish App Home for a single user
async function publishHome(client, userId) {
  await client.views.publish({
    user_id: userId,
    view: {
      type: 'home',
      callback_id: 'home_view',
      blocks: buildHomeBlocks(),
    },
  });
}

// Slack App Home Tab
slackApp.event('app_home_opened', async ({ event, client }) => {
  try {
    await publishHome(client, event.user);
  } catch (error) {
    console.error('Error publishing home view:', error);
  }
});

// Webhook endpoint for external apps (express.json() applied only here)
expressApp.post('/webhook', express.json(), async (req, res) => {
  try {
    const { message, source = 'external-app', channel = 'C09DH2G0K0Q' } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const webhookMessage = {
      message,
      source,
      timestamp: new Date().toISOString(),
      id: Date.now().toString()
    };

    // Store the message
    webhookMessages.push(webhookMessage);

    // Keep only last 50 messages
    if (webhookMessages.length > 50) {
      webhookMessages.shift();
    }

    // Post to Slack channel if specified
    if (channel) {
      try {
        await slackApp.client.chat.postMessage({
          channel: channel,
          text: `Webhook Message from ${source}:\n${message}`,
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `*Webhook Message from ${source}*\n${message}`
              }
            },
            {
              type: 'context',
              elements: [
                {
                  type: 'mrkdwn',
                  text: `${new Date().toLocaleString()}`
                }
              ]
            }
          ]
        });
      } catch (slackError) {
        console.error('Error posting to Slack channel:', slackError);
      }
    }

    // Update app home for all users
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
      id: webhookMessage.id
    });

  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Mount Bolt's Express app AFTER our routes — Slack events handled at /slack/events
expressApp.use(receiver.app);

// Start server
expressApp.listen(port, '0.0.0.0', () => {
  console.log(`Aardvark Slack App listening on port ${port}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Slack App configured with Client ID: ${process.env.SLACK_CLIENT_ID}`);
});

module.exports = expressApp;
