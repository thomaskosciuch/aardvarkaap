import { slackApp } from '../slack';
import { publishHome } from './home';

slackApp.event('app_home_opened', async ({ event, client }) => {
  try {
    await publishHome(client, event.user);
  } catch (error) {
    console.error('Error publishing home view:', error);
  }
});

// Nav bar actions
slackApp.action('nav_dashboard', async ({ ack, body, client }) => {
  await ack();
  await publishHome(client, body.user.id, 'dashboard');
});

slackApp.action('nav_admins', async ({ ack, body, client }) => {
  await ack();
  await publishHome(client, body.user.id, 'admins');
});

// Catch message events so Bolt acks them (prevents 3-second timeout warning)
slackApp.event('message', async () => {});
