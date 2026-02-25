const { slackApp } = require('../slack');
const { publishHome } = require('./home');

slackApp.event('app_home_opened', async ({ event, client }) => {
  try {
    await publishHome(client, event.user);
  } catch (error) {
    console.error('Error publishing home view:', error);
  }
});

// Catch message events so Bolt acks them (prevents 3-second timeout warning)
slackApp.event('message', async () => {});
