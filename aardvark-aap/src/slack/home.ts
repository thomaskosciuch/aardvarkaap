import type { WebClient } from '@slack/web-api';
import type { KnownBlock, View } from '@slack/types';
import * as store from '../store';
import * as dbAdmins from '../db/admins';
import * as jobsDb from '../db/jobs';
import * as cronRuns from '../db/cron-runs';
import type { WebhookMessage } from '../store';
import type { Admin } from '../db/admins';
import type { Job } from '../db/jobs';
import type { CronRun } from '../db/cron-runs';

export type HomeTab = 'dashboard' | 'admins' | 'processes';

interface AdminInfo {
  isAdmin: boolean;
  isSuperAdmin: boolean;
  admins: Admin[];
}

interface ProcessesInfo {
  jobs: Job[];
  latestRuns: CronRun[];
}

function buildHomeBlocks(
  tab: HomeTab,
  adminInfo?: AdminInfo,
  processesInfo?: ProcessesInfo,
): KnownBlock[] {
  const blocks: KnownBlock[] = [
    ...navBar(tab, adminInfo?.isAdmin ?? false),
  ];

  if (tab === 'admins' && adminInfo?.isAdmin) {
    blocks.push(...adminsPage(adminInfo.admins, adminInfo.isSuperAdmin));
  } else if (tab === 'processes' && adminInfo?.isAdmin) {
    blocks.push(...processesPage(processesInfo));
  } else {
    blocks.push(...dashboardPage(adminInfo));
  }

  return blocks;
}

// --- Nav bar ---

function navBar(activeTab: HomeTab, isAdmin: boolean): KnownBlock[] {
  const buttons: object[] = [
    {
      type: 'button',
      text: { type: 'plain_text', text: ':house:  Dashboard', emoji: true },
      action_id: 'nav_dashboard',
      ...(activeTab === 'dashboard' ? { style: 'primary' } : {}),
    },
  ];

  if (isAdmin) {
    buttons.push(
      {
        type: 'button',
        text: { type: 'plain_text', text: ':gear:  Processes', emoji: true },
        action_id: 'nav_processes',
        ...(activeTab === 'processes' ? { style: 'primary' } : {}),
      },
      {
        type: 'button',
        text: { type: 'plain_text', text: ':lock:  Admins', emoji: true },
        action_id: 'nav_admins',
        ...(activeTab === 'admins' ? { style: 'primary' } : {}),
      },
    );
  }

  return [
    { type: 'actions', elements: buttons } as KnownBlock,
    { type: 'divider' },
  ];
}

// --- Dashboard tab ---

function dashboardPage(adminInfo?: AdminInfo): KnownBlock[] {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayMessages = store.messages.filter(m => new Date(m.timestamp) >= todayStart);

  const uptimeStr = formatUptime();

  return [
    ...todaySection(uptimeStr, todayMessages),
    { type: 'divider' },
    ...logSection(),
    { type: 'divider' },
    ...configSection(adminInfo?.isAdmin ?? false),
  ];
}

function formatUptime(): string {
  const secs = Math.floor((Date.now() - store.startTime) / 1000);
  const days = Math.floor(secs / 86400);
  const hours = Math.floor((secs % 86400) / 3600);
  const minutes = Math.floor((secs % 3600) / 60);

  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function todaySection(uptimeStr: string, todayMessages: WebhookMessage[]): KnownBlock[] {
  const blocks: KnownBlock[] = [
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

  // Sources breakdown
  const sourceCounts: Record<string, number> = {};
  for (const msg of todayMessages) {
    sourceCounts[msg.source] = (sourceCounts[msg.source] || 0) + 1;
  }
  const entries = Object.entries(sourceCounts);
  if (entries.length > 0) {
    const text = entries
      .sort((a, b) => b[1] - a[1])
      .map(([source, count]) => `${source}: ${count}`)
      .join('  |  ');
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text }],
    });
  }

  return blocks;
}

function logSection(): KnownBlock[] {
  const blocks: KnownBlock[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: 'Log' },
    },
  ];

  if (store.messages.length === 0) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: '_No messages yet._' },
    });
    return blocks;
  }

  const recent = store.getRecent(5);
  for (const msg of recent) {
    const ts = Math.floor(new Date(msg.timestamp).getTime() / 1000);
    blocks.push(
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*${msg.source}*\n${msg.message}` },
      },
      {
        type: 'context',
        elements: [
          { type: 'mrkdwn', text: `<!date^${ts}^{date_short_pretty} at {time}|${msg.timestamp}>` },
        ],
      }
    );
  }

  if (store.messages.length > 5) {
    blocks.push({
      type: 'context',
      elements: [
        { type: 'mrkdwn', text: `_${store.messages.length - 5} older messages not shown_` },
      ],
    });
  }

  return blocks;
}

function configSection(isAdmin: boolean): KnownBlock[] {
  const blocks: KnownBlock[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: 'Config' },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: '*Webhook endpoint:*\n`POST /webhook`' },
        { type: 'mrkdwn', text: '*Default channel:*\n<#C09DH2G0K0Q>' },
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
    },
  ];

  if (isAdmin) {
    blocks.push(
      { type: 'divider' },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*Slash commands:*\n'
            + '`/db-listusers` — list database users\n'
            + '`/db-adduser <user> <pass>` — create read-only user (admin)\n'
            + '`/db-removeuser <user>` — drop user (super-admin)\n'
            + '`/db-addadmin @user` — add admin (admin)\n'
            + '`/db-removeadmin @user` — remove admin (admin)\n'
            + '`/db-whitelist-ip <ip>` — whitelist IP for bastion SSH\n'
            + '`/db-remove-ip <ip>` — remove IP from whitelist\n'
            + '`/db-list-ips` — show whitelisted IPs',
        },
      },
    );
  }

  return blocks;
}

// --- Admins tab ---

function adminsPage(admins: Admin[], viewerIsSuperAdmin: boolean): KnownBlock[] {
  const blocks: KnownBlock[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: 'Admins' },
    },
  ];

  if (admins.length === 0) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: '_No admins configured._' },
    });
    return blocks;
  }

  for (const admin of admins) {
    const role = admin.isSuperAdmin ? ':star: *super-admin*' : 'admin';
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `<@${admin.slackUserId}>  —  ${role}` },
    });
  }

  blocks.push(
    { type: 'divider' },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: '`/db-addadmin @user` — add admin  |  `/db-removeadmin @user` — remove admin'
            + (viewerIsSuperAdmin ? '' : '\n_Super-admins cannot be removed by regular admins._'),
        },
      ],
    },
  );

  return blocks;
}

// --- Processes tab ---

function processesPage(info?: ProcessesInfo): KnownBlock[] {
  const blocks: KnownBlock[] = [];

  // Header with Add Process button
  blocks.push(
    {
      type: 'header',
      text: { type: 'plain_text', text: ':gear:  Processes' },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: 'Registered cron jobs and processes monitored by Aardvark.',
      },
      accessory: {
        type: 'button',
        text: { type: 'plain_text', text: ':heavy_plus_sign:  Add Process', emoji: true },
        action_id: 'open_add_process',
        style: 'primary',
      },
    } as KnownBlock,
  );

  // --- Registered jobs list ---
  blocks.push({ type: 'divider' });

  const jobs = info?.jobs ?? [];
  const latestRuns = info?.latestRuns ?? [];
  const runsByJob = new Map<string, CronRun>();
  for (const run of latestRuns) {
    runsByJob.set(run.jobName, run);
  }

  if (jobs.length === 0) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: '_No processes registered yet. Click *Add Process* to get started._' },
    });
  } else {
    for (const job of jobs) {
      const latest = runsByJob.get(job.jobName);
      const statusEmoji = getStatusEmoji(latest);
      const lastRunText = latest
        ? `Last: *${latest.status}* <!date^${Math.floor(latest.createdAt.getTime() / 1000)}^{date_short_pretty} at {time}|${latest.createdAt.toISOString()}>`
        : '_No runs yet_';

      const severityBadge = job.severity === 'high' ? ':red_circle:' : job.severity === 'medium' ? ':large_orange_circle:' : ':white_circle:';
      const scheduleText = job.schedule ? `\`${job.schedule}\`` : `every ${formatSeconds(job.expectedEveryS)}`;

      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${statusEmoji} *${job.jobName}*  ${severityBadge}\n`
            + (job.description ? `${job.description}\n` : '')
            + `:clock1: ${scheduleText}  |  ${lastRunText}`,
        },
      });
    }
  }

  // --- Setup instructions ---
  blocks.push(
    { type: 'divider' },
    {
      type: 'header',
      text: { type: 'plain_text', text: ':book:  How to set up logging' },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: 'To monitor a cron job or scheduled process with Aardvark, follow these steps:',
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*Step 1 — Register the process*\n'
          + 'Click *Add Process* above and fill in the name, schedule, and expected interval. '
          + 'Aardvark will flag the job as _missed_ if no heartbeat arrives within that interval.',
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*Step 2 — Add heartbeat calls to your script*\n'
          + 'At the start and end of your cron job, send a POST request to the collector endpoint:\n'
          + '```POST http://Aardva-Aardv-RxgkhBCzdLSX-559408849.ca-central-1.elb.amazonaws.com/collector/run\nContent-Type: application/json\n\n'
          + '{\n'
          + '  "job_name": "my-etl-job",\n'
          + '  "status": "started"\n'
          + '}```',
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: 'When the job finishes, report success or failure:\n'
          + '```POST http://Aardva-Aardv-RxgkhBCzdLSX-559408849.ca-central-1.elb.amazonaws.com/collector/run\n\n'
          + '{\n'
          + '  "job_name": "my-etl-job",\n'
          + '  "status": "success",\n'
          + '  "duration_s": 42.5,\n'
          + '  "message": "Processed 1,200 rows"\n'
          + '}```',
      },
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: ':bulb: *Tip:* Valid statuses are `started`, `success`, and `failed`. '
            + 'The `duration_s` and `message` fields are optional.',
        },
      ],
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*Collector API reference:*\n'
          + '• `POST http://Aardva-Aardv-RxgkhBCzdLSX-559408849.ca-central-1.elb.amazonaws.com/collector/run` — log a run (started / success / failed)\n'
          + '• `GET http://Aardva-Aardv-RxgkhBCzdLSX-559408849.ca-central-1.elb.amazonaws.com/collector/status/:job_name` — get the latest run for a job',
      },
    },
  );

  return blocks;
}

function getStatusEmoji(latestRun?: CronRun): string {
  if (!latestRun) return ':white_circle:';
  switch (latestRun.status) {
    case 'success': return ':large_green_circle:';
    case 'failed':  return ':red_circle:';
    case 'started': return ':large_blue_circle:';
    case 'missed':  return ':warning:';
    default:        return ':white_circle:';
  }
}

function formatSeconds(s: number): string {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

// --- Add Process modal ---

export function buildAddProcessModal(): View {
  return {
    type: 'modal',
    callback_id: 'add_process_modal',
    title: { type: 'plain_text', text: 'Add Process' },
    submit: { type: 'plain_text', text: 'Register' },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks: [
      {
        type: 'input',
        block_id: 'job_name_block',
        label: { type: 'plain_text', text: 'Process name' },
        element: {
          type: 'plain_text_input',
          action_id: 'job_name',
          placeholder: { type: 'plain_text', text: 'e.g. nightly-etl, db-backup' },
        },
        hint: { type: 'plain_text', text: 'A unique slug used in API calls. Lowercase, hyphens allowed.' },
      },
      {
        type: 'input',
        block_id: 'description_block',
        label: { type: 'plain_text', text: 'Description' },
        optional: true,
        element: {
          type: 'plain_text_input',
          action_id: 'description',
          placeholder: { type: 'plain_text', text: 'What does this process do?' },
        },
      },
      {
        type: 'input',
        block_id: 'schedule_block',
        label: { type: 'plain_text', text: 'Schedule (cron expression)' },
        optional: true,
        element: {
          type: 'plain_text_input',
          action_id: 'schedule',
          placeholder: { type: 'plain_text', text: 'e.g. 0 2 * * *  (daily at 2am)' },
        },
        hint: { type: 'plain_text', text: 'For display only — Aardvark does not trigger the job.' },
      },
      {
        type: 'input',
        block_id: 'expected_every_block',
        label: { type: 'plain_text', text: 'Expected every (seconds)' },
        element: {
          type: 'plain_text_input',
          action_id: 'expected_every_s',
          placeholder: { type: 'plain_text', text: 'e.g. 86400 for daily, 3600 for hourly' },
        },
        hint: { type: 'plain_text', text: 'If no heartbeat arrives within this window, the job is flagged as missed.' },
      },
      {
        type: 'input',
        block_id: 'max_runtime_block',
        label: { type: 'plain_text', text: 'Max runtime (seconds)' },
        optional: true,
        element: {
          type: 'plain_text_input',
          action_id: 'max_runtime_s',
          placeholder: { type: 'plain_text', text: 'e.g. 600 for 10 minutes' },
        },
        hint: { type: 'plain_text', text: 'If a "started" run exceeds this, the job is flagged as stuck.' },
      },
      {
        type: 'input',
        block_id: 'severity_block',
        label: { type: 'plain_text', text: 'Severity' },
        element: {
          type: 'static_select',
          action_id: 'severity',
          initial_option: {
            text: { type: 'plain_text', text: ':large_orange_circle: Medium' },
            value: 'medium',
          },
          options: [
            { text: { type: 'plain_text', text: ':white_circle: Low' },             value: 'low' },
            { text: { type: 'plain_text', text: ':large_orange_circle: Medium' },    value: 'medium' },
            { text: { type: 'plain_text', text: ':red_circle: High' },               value: 'high' },
          ],
        },
      },
    ] as KnownBlock[],
  } as View;
}

// --- Publish ---

async function publishHome(client: WebClient, userId: string, tab: HomeTab = 'dashboard'): Promise<void> {
  let adminInfo: AdminInfo | undefined;
  let processesInfo: ProcessesInfo | undefined;

  try {
    const userIsAdmin = await dbAdmins.isAdmin(userId);
    if (userIsAdmin) {
      const [userIsSuperAdmin, admins] = await Promise.all([
        dbAdmins.isSuperAdmin(userId),
        dbAdmins.listAdmins(),
      ]);
      adminInfo = { isAdmin: true, isSuperAdmin: userIsSuperAdmin, admins };
    }
  } catch (err) {
    console.error('Error fetching admin info for home view:', err);
  }

  // Non-admins can't view the admins or processes tabs — fall back to dashboard
  const resolvedTab = adminInfo?.isAdmin ? tab : 'dashboard';

  // Fetch processes data if on that tab
  if (resolvedTab === 'processes') {
    try {
      const [jobs, latestRuns] = await Promise.all([
        jobsDb.listJobs(true),
        cronRuns.getLatestRunPerJob(),
      ]);
      processesInfo = { jobs, latestRuns };
    } catch (err) {
      console.error('Error fetching processes info:', err);
      processesInfo = { jobs: [], latestRuns: [] };
    }
  }

  await client.views.publish({
    user_id: userId,
    view: {
      type: 'home',
      callback_id: 'home_view',
      blocks: buildHomeBlocks(resolvedTab, adminInfo, processesInfo),
    },
  });
}

export { buildHomeBlocks, publishHome };
