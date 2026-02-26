import { slackApp } from '../slack';
import * as dbUsers from '../db/users';
import * as dbAdmins from '../db/admins';

console.log('Slash commands registered: /db-adduser, /db-listusers, /db-removeuser, /db-addadmin, /db-removeadmin');

// --- Database user commands ---

// /db-adduser <username> <password>
slackApp.command('/db-adduser', async ({ ack, body, respond }) => {
  await ack();

  if (!(await dbAdmins.isAdmin(body.user_id))) {
    await respond({ text: ':no_entry: Only admins can add database users.', response_type: 'ephemeral' });
    return;
  }

  const args = (body.text || '').trim().split(/\s+/);
  if (args.length < 2) {
    await respond({ text: ':warning: Usage: `/db-adduser <username> <password>`', response_type: 'ephemeral' });
    return;
  }

  const [username, password] = args;

  try {
    await dbUsers.createUser(username, password);
    await respond({
      text: `:white_check_mark: Created user \`${username}\` with *read-only* access.`,
      response_type: 'ephemeral',
    });
  } catch (err: unknown) {
    console.error('db-adduser error:', err);
    const message = err instanceof Error ? err.message : String(err);
    await respond({
      text: `:x: Failed to create user: ${message}`,
      response_type: 'ephemeral',
    });
  }
});

// /db-listusers
slackApp.command('/db-listusers', async ({ ack, respond }) => {
  await ack();

  try {
    const users = await dbUsers.listUsers();

    if (users.length === 0) {
      await respond({ text: '_No database users found._', response_type: 'ephemeral' });
      return;
    }

    const lines = users.map(u => `\`${u.user}\`  —  ${u.grantLevel}`);
    await respond({
      text: `:card_file_box: *Database users:*\n${lines.join('\n')}`,
      response_type: 'ephemeral',
    });
  } catch (err: unknown) {
    console.error('db-listusers error:', err);
    const message = err instanceof Error ? err.message : String(err);
    await respond({
      text: `:x: Failed to list users: ${message}`,
      response_type: 'ephemeral',
    });
  }
});

// /db-removeuser <username>
slackApp.command('/db-removeuser', async ({ ack, body, respond }) => {
  await ack();

  if (!(await dbAdmins.isSuperAdmin(body.user_id))) {
    await respond({ text: ':no_entry: Only super-admins can remove database users.', response_type: 'ephemeral' });
    return;
  }

  const username = (body.text || '').trim().split(/\s+/)[0];
  if (!username) {
    await respond({ text: ':warning: Usage: `/db-removeuser <username>`', response_type: 'ephemeral' });
    return;
  }

  if (username === 'aardvark_admin') {
    await respond({ text: ':no_entry: Cannot remove the RDS admin user.', response_type: 'ephemeral' });
    return;
  }

  try {
    await dbUsers.removeUser(username);
    await respond({
      text: `:wastebasket: Removed user \`${username}\`.`,
      response_type: 'ephemeral',
    });
  } catch (err: unknown) {
    console.error('db-removeuser error:', err);
    const message = err instanceof Error ? err.message : String(err);
    await respond({
      text: `:x: Failed to remove user: ${message}`,
      response_type: 'ephemeral',
    });
  }
});

// --- Admin management commands ---

function parseSlackUserId(text: string): string | null {
  const trimmed = text.trim();
  // Slack mention format: <@U12345|name> or <@U12345>
  const mentionMatch = trimmed.match(/^<@([A-Z0-9]+)\|?[^>]*>$/);
  if (mentionMatch) return mentionMatch[1];
  // Raw user ID
  const rawMatch = trimmed.match(/^([A-Z0-9]+)$/);
  if (rawMatch) return rawMatch[1];
  return null;
}

// /db-addadmin @user
slackApp.command('/db-addadmin', async ({ ack, body, respond }) => {
  await ack();

  if (!(await dbAdmins.isAdmin(body.user_id))) {
    await respond({ text: ':no_entry: Only admins can add other admins.', response_type: 'ephemeral' });
    return;
  }

  const userId = parseSlackUserId(body.text || '');
  if (!userId) {
    await respond({ text: ':warning: Usage: `/db-addadmin @user` or `/db-addadmin U12345ABC`', response_type: 'ephemeral' });
    return;
  }

  try {
    await dbAdmins.addAdmin(userId);
    await respond({
      text: `:white_check_mark: <@${userId}> is now an admin.`,
      response_type: 'ephemeral',
    });
  } catch (err: unknown) {
    console.error('db-addadmin error:', err);
    const message = err instanceof Error ? err.message : String(err);
    await respond({
      text: `:x: Failed to add admin: ${message}`,
      response_type: 'ephemeral',
    });
  }
});

// /db-removeadmin @user
slackApp.command('/db-removeadmin', async ({ ack, body, respond }) => {
  await ack();

  if (!(await dbAdmins.isAdmin(body.user_id))) {
    await respond({ text: ':no_entry: Only admins can remove other admins.', response_type: 'ephemeral' });
    return;
  }

  const userId = parseSlackUserId(body.text || '');
  if (!userId) {
    await respond({ text: ':warning: Usage: `/db-removeadmin @user` or `/db-removeadmin U12345ABC`', response_type: 'ephemeral' });
    return;
  }

  try {
    await dbAdmins.removeAdmin(userId);
    await respond({
      text: `:wastebasket: <@${userId}> is no longer an admin.`,
      response_type: 'ephemeral',
    });
  } catch (err: unknown) {
    console.error('db-removeadmin error:', err);
    const message = err instanceof Error ? err.message : String(err);
    await respond({
      text: `:x: Failed to remove admin: ${message}`,
      response_type: 'ephemeral',
    });
  }
});
