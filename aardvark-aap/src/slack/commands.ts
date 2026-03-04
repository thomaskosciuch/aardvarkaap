import { EC2Client, AuthorizeSecurityGroupIngressCommand, RevokeSecurityGroupIngressCommand, DescribeSecurityGroupsCommand } from '@aws-sdk/client-ec2';
import { slackApp } from '../slack';
import * as dbUsers from '../db/users';
import * as dbAdmins from '../db/admins';
import { getPool } from '../db/connection';

const ec2 = new EC2Client({});
const BASTION_SG_ID = process.env.BASTION_SG_ID;

console.log('Slash commands registered: /db-adduser, /db-listusers, /db-removeuser, /db-addadmin, /db-removeadmin, /db-whitelist-ip, /db-remove-ip, /db-list-ips');

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

// nom  @user
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

// --- Bastion IP whitelisting commands ---

function isValidIpv4(ip: string): boolean {
  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  return parts.every(part => {
    const num = Number(part);
    return Number.isInteger(num) && num >= 0 && num <= 255 && part === String(num);
  });
}

// /db-whitelist-ip <ip>
slackApp.command('/db-whitelist-ip', async ({ command, ack, respond }) => {
  await ack();

  if (!BASTION_SG_ID) {
    await respond({ text: ':x: BASTION_SG_ID is not configured. Contact an admin.', response_type: 'ephemeral' });
    return;
  }

  const ip = command.text.trim();
  if (!ip || !isValidIpv4(ip)) {
    await respond({ text: ':warning: Please provide a valid IPv4 address.\nUsage: `/db-whitelist-ip 1.2.3.4`', response_type: 'ephemeral' });
    return;
  }

  const cidr = `${ip}/32`;

  try {
    await ec2.send(new AuthorizeSecurityGroupIngressCommand({
      GroupId: BASTION_SG_ID,
      IpPermissions: [{
        IpProtocol: 'tcp',
        FromPort: 22,
        ToPort: 22,
        IpRanges: [{ CidrIp: cidr, Description: `Whitelisted by ${command.user_name} via Slack` }],
      }],
    }));

    // Record in database
    try {
      const pool = getPool();
      await pool.execute(
        'INSERT INTO ip_whitelist (ip_address, whitelisted_by, slack_user_id) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE whitelisted_by = VALUES(whitelisted_by), slack_user_id = VALUES(slack_user_id), whitelisted_at = CURRENT_TIMESTAMP',
        [ip, command.user_name, command.user_id],
      );
    } catch (dbErr) {
      console.error('Failed to record IP whitelist in database:', dbErr);
    }

    await respond({ text: `:white_check_mark: IP \`${cidr}\` has been whitelisted for SSH access to the bastion host.`, response_type: 'ephemeral' });
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'InvalidPermission.Duplicate') {
      await respond({ text: `:information_source: IP \`${cidr}\` is already whitelisted.`, response_type: 'ephemeral' });
    } else {
      console.error('Error whitelisting IP:', err);
      const message = err instanceof Error ? err.message : String(err);
      await respond({ text: `:x: Failed to whitelist IP: ${message}`, response_type: 'ephemeral' });
    }
  }
});

// /db-remove-ip <ip>
slackApp.command('/db-remove-ip', async ({ command, ack, respond }) => {
  await ack();

  if (!BASTION_SG_ID) {
    await respond({ text: ':x: BASTION_SG_ID is not configured. Contact an admin.', response_type: 'ephemeral' });
    return;
  }

  const ip = command.text.trim();
  if (!ip || !isValidIpv4(ip)) {
    await respond({ text: ':warning: Please provide a valid IPv4 address.\nUsage: `/db-remove-ip 1.2.3.4`', response_type: 'ephemeral' });
    return;
  }

  const cidr = `${ip}/32`;

  try {
    await ec2.send(new RevokeSecurityGroupIngressCommand({
      GroupId: BASTION_SG_ID,
      IpPermissions: [{
        IpProtocol: 'tcp',
        FromPort: 22,
        ToPort: 22,
        IpRanges: [{ CidrIp: cidr }],
      }],
    }));

    // Remove from database
    try {
      const pool = getPool();
      await pool.execute('DELETE FROM ip_whitelist WHERE ip_address = ?', [ip]);
    } catch (dbErr) {
      console.error('Failed to remove IP whitelist from database:', dbErr);
    }

    await respond({ text: `:white_check_mark: IP \`${cidr}\` has been removed from the bastion whitelist.`, response_type: 'ephemeral' });
  } catch (err: unknown) {
    console.error('Error removing IP:', err);
    const message = err instanceof Error ? err.message : String(err);
    await respond({ text: `:x: Failed to remove IP: ${message}`, response_type: 'ephemeral' });
  }
});

// /db-list-ips
slackApp.command('/db-list-ips', async ({ ack, respond }) => {
  await ack();

  if (!BASTION_SG_ID) {
    await respond({ text: ':x: BASTION_SG_ID is not configured. Contact an admin.', response_type: 'ephemeral' });
    return;
  }

  try {
    const pool = getPool();
    const [rows] = await pool.execute(
      'SELECT ip_address, whitelisted_by, whitelisted_at FROM ip_whitelist ORDER BY whitelisted_at DESC',
    );

    const entries = rows as Array<{ ip_address: string; whitelisted_by: string; whitelisted_at: Date }>;

    if (entries.length === 0) {
      await respond({ text: ':information_source: No IPs are currently whitelisted for bastion SSH access.', response_type: 'ephemeral' });
    } else {
      const lines = entries.map(row => {
        const when = new Date(row.whitelisted_at).toLocaleDateString('en-CA');
        return `\`${row.ip_address}/32\` — whitelisted by *${row.whitelisted_by}* on ${when}`;
      });
      await respond({
        text: `:lock: *Whitelisted IPs for bastion SSH access:*\n${lines.map(l => `• ${l}`).join('\n')}`,
        response_type: 'ephemeral',
      });
    }
  } catch (err: unknown) {
    // Fall back to security group if DB is unavailable
    console.error('Database query failed, falling back to security group:', err);
    try {
      const { SecurityGroups } = await ec2.send(new DescribeSecurityGroupsCommand({ GroupIds: [BASTION_SG_ID] }));
      const sshRules = (SecurityGroups?.[0]?.IpPermissions ?? []).filter(
        r => r.FromPort === 22 && r.ToPort === 22 && r.IpProtocol === 'tcp',
      );
      const ips = sshRules.flatMap(rule =>
        (rule.IpRanges ?? []).map(range => {
          const desc = range.Description ? ` — _${range.Description}_` : '';
          return `\`${range.CidrIp}\`${desc}`;
        }),
      );

      if (ips.length === 0) {
        await respond({ text: ':information_source: No IPs are currently whitelisted for bastion SSH access.', response_type: 'ephemeral' });
      } else {
        await respond({ text: `:lock: *Whitelisted IPs for bastion SSH access:*\n${ips.map(ip => `• ${ip}`).join('\n')}`, response_type: 'ephemeral' });
      }
    } catch (sgErr: unknown) {
      console.error('Error listing IPs:', sgErr);
      const message = sgErr instanceof Error ? sgErr.message : String(sgErr);
      await respond({ text: `:x: Failed to list IPs: ${message}`, response_type: 'ephemeral' });
    }
  }
});
