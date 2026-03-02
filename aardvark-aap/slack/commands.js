const { EC2Client, AuthorizeSecurityGroupIngressCommand, RevokeSecurityGroupIngressCommand, DescribeSecurityGroupsCommand } = require('@aws-sdk/client-ec2');
const { slackApp } = require('../slack');
const db = require('../db');

const ec2 = new EC2Client();
const BASTION_SG_ID = process.env.BASTION_SG_ID;

/**
 * Validate an IPv4 address.
 */
function isValidIpv4(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  return parts.every(part => {
    const num = Number(part);
    return Number.isInteger(num) && num >= 0 && num <= 255 && part === String(num);
  });
}

/**
 * Get current SSH ingress rules on the bastion security group.
 */
async function getBastionIngressRules() {
  const { SecurityGroups } = await ec2.send(new DescribeSecurityGroupsCommand({
    GroupIds: [BASTION_SG_ID],
  }));

  if (!SecurityGroups || SecurityGroups.length === 0) {
    throw new Error('Bastion security group not found');
  }

  return SecurityGroups[0].IpPermissions.filter(
    rule => rule.FromPort === 22 && rule.ToPort === 22 && rule.IpProtocol === 'tcp'
  );
}

// --- /db-whitelist-ip ---
slackApp.command('/db-whitelist-ip', async ({ command, ack, respond }) => {
  await ack();

  if (!BASTION_SG_ID) {
    await respond({ text: ':x: BASTION_SG_ID is not configured. Contact an admin.' });
    return;
  }

  const ip = command.text.trim();
  if (!ip || !isValidIpv4(ip)) {
    await respond({ text: ':warning: Please provide a valid IPv4 address.\nUsage: `/db-whitelist-ip 1.2.3.4`' });
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
      await db.query(
        'INSERT INTO ip_whitelist (ip_address, whitelisted_by, slack_user_id) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE whitelisted_by = VALUES(whitelisted_by), slack_user_id = VALUES(slack_user_id), whitelisted_at = CURRENT_TIMESTAMP',
        [ip, command.user_name, command.user_id]
      );
    } catch (dbError) {
      console.error('Failed to record IP whitelist in database:', dbError.message);
    }

    await respond({ text: `:white_check_mark: IP \`${cidr}\` has been whitelisted for SSH access to the bastion host.` });
  } catch (error) {
    if (error.name === 'InvalidPermission.Duplicate') {
      await respond({ text: `:information_source: IP \`${cidr}\` is already whitelisted.` });
    } else {
      console.error('Error whitelisting IP:', error);
      await respond({ text: `:x: Failed to whitelist IP: ${error.message}` });
    }
  }
});

// --- /db-remove-ip ---
slackApp.command('/db-remove-ip', async ({ command, ack, respond }) => {
  await ack();

  if (!BASTION_SG_ID) {
    await respond({ text: ':x: BASTION_SG_ID is not configured. Contact an admin.' });
    return;
  }

  const ip = command.text.trim();
  if (!ip || !isValidIpv4(ip)) {
    await respond({ text: ':warning: Please provide a valid IPv4 address.\nUsage: `/db-remove-ip 1.2.3.4`' });
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
      await db.query('DELETE FROM ip_whitelist WHERE ip_address = ?', [ip]);
    } catch (dbError) {
      console.error('Failed to remove IP whitelist from database:', dbError.message);
    }

    await respond({ text: `:white_check_mark: IP \`${cidr}\` has been removed from the bastion whitelist.` });
  } catch (error) {
    console.error('Error removing IP:', error);
    await respond({ text: `:x: Failed to remove IP: ${error.message}` });
  }
});

// --- /db-list-ips ---
slackApp.command('/db-list-ips', async ({ ack, respond }) => {
  await ack();

  if (!BASTION_SG_ID) {
    await respond({ text: ':x: BASTION_SG_ID is not configured. Contact an admin.' });
    return;
  }

  try {
    // Pull from database for richer info (who whitelisted, when)
    const rows = await db.query('SELECT ip_address, whitelisted_by, whitelisted_at FROM ip_whitelist ORDER BY whitelisted_at DESC');

    if (rows.length === 0) {
      await respond({ text: ':information_source: No IPs are currently whitelisted for bastion SSH access.' });
    } else {
      const lines = rows.map(row => {
        const when = new Date(row.whitelisted_at).toLocaleDateString('en-CA');
        return `\`${row.ip_address}/32\` — whitelisted by *${row.whitelisted_by}* on ${when}`;
      });
      await respond({ text: `:lock: *Whitelisted IPs for bastion SSH access:*\n${lines.map(l => `• ${l}`).join('\n')}` });
    }
  } catch (error) {
    // Fall back to security group if DB is unavailable
    console.error('Database query failed, falling back to security group:', error.message);
    try {
      const sshRules = await getBastionIngressRules();
      const ips = sshRules.flatMap(rule =>
        (rule.IpRanges || []).map(range => {
          const desc = range.Description ? ` — _${range.Description}_` : '';
          return `\`${range.CidrIp}\`${desc}`;
        })
      );

      if (ips.length === 0) {
        await respond({ text: ':information_source: No IPs are currently whitelisted for bastion SSH access.' });
      } else {
        await respond({ text: `:lock: *Whitelisted IPs for bastion SSH access:*\n${ips.map(ip => `• ${ip}`).join('\n')}` });
      }
    } catch (sgError) {
      console.error('Error listing IPs:', sgError);
      await respond({ text: `:x: Failed to list IPs: ${sgError.message}` });
    }
  }
});
