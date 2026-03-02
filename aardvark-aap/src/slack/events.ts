import { slackApp } from '../slack';
import { publishHome, buildAddProcessModal } from './home';
import * as jobsDb from '../db/jobs';
import * as activityLog from '../db/activity-log';
import type { Severity } from '../db/jobs';

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

slackApp.action('nav_processes', async ({ ack, body, client }) => {
  await ack();
  await publishHome(client, body.user.id, 'processes');
});

// Open the Add Process modal
slackApp.action('open_add_process', async ({ ack, body, client }) => {
  await ack();

  const triggerId = 'trigger_id' in body ? (body as unknown as Record<string, unknown>).trigger_id as string : undefined;
  if (!triggerId) {
    console.error('No trigger_id for add process modal');
    return;
  }

  await client.views.open({
    trigger_id: triggerId,
    view: buildAddProcessModal(),
  });
});

// Handle Add Process modal submission
slackApp.view('add_process_modal', async ({ ack, body, view, client }) => {
  const values = view.state.values;

  const jobName = values.job_name_block?.job_name?.value?.trim() ?? '';
  const description = values.description_block?.description?.value?.trim() || undefined;
  const schedule = values.schedule_block?.schedule?.value?.trim() || undefined;
  const expectedEveryStr = values.expected_every_block?.expected_every_s?.value?.trim() ?? '';
  const maxRuntimeStr = values.max_runtime_block?.max_runtime_s?.value?.trim() || undefined;
  const severity = (values.severity_block?.severity as { selected_option?: { value: string } })
    ?.selected_option?.value as Severity | undefined;

  // Validate job name
  if (!jobName || !/^[a-z0-9][a-z0-9._-]*$/.test(jobName)) {
    await ack({
      response_action: 'errors',
      errors: {
        job_name_block: 'Name must start with a letter/number and contain only lowercase letters, numbers, hyphens, dots, or underscores.',
      },
    });
    return;
  }

  // Validate expected interval
  const expectedEveryS = parseInt(expectedEveryStr, 10);
  if (isNaN(expectedEveryS) || expectedEveryS < 1) {
    await ack({
      response_action: 'errors',
      errors: {
        expected_every_block: 'Must be a positive number of seconds (e.g. 3600 for hourly).',
      },
    });
    return;
  }

  // Validate max runtime if provided
  let maxRuntimeS: number | undefined;
  if (maxRuntimeStr) {
    maxRuntimeS = parseInt(maxRuntimeStr, 10);
    if (isNaN(maxRuntimeS) || maxRuntimeS < 1) {
      await ack({
        response_action: 'errors',
        errors: {
          max_runtime_block: 'Must be a positive number of seconds.',
        },
      });
      return;
    }
  }

  // Check for duplicate
  const existing = await jobsDb.getJob(jobName);
  if (existing) {
    await ack({
      response_action: 'errors',
      errors: {
        job_name_block: `A process named "${jobName}" is already registered.`,
      },
    });
    return;
  }

  // All good — register
  await ack();

  try {
    await jobsDb.registerJob({
      jobName,
      description,
      schedule,
      expectedEveryS,
      maxRuntimeS,
      severity: severity ?? 'medium',
    });

    await activityLog.logActivity({
      jobName,
      eventType: 'job_registered',
      actor: body.user.id,
      detail: `Registered via Slack modal (expected every ${expectedEveryS}s, severity: ${severity ?? 'medium'})`,
    });

    // Refresh the processes tab
    await publishHome(client, body.user.id, 'processes');
  } catch (err) {
    console.error('Error registering process:', err);
  }
});

// Catch message events so Bolt acks them (prevents 3-second timeout warning)
slackApp.event('message', async () => {});
