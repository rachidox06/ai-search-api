/**
 * Simple Slack notifier - sends cron job summaries to Slack
 */

const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;

/**
 * Send a cron job summary to Slack
 */
export async function sendCronSummary(summary) {
  if (!SLACK_WEBHOOK_URL) {
    console.log('[Slack] No webhook URL configured, skipping notification');
    return false;
  }

  const {
    date,
    total_prompts,
    successful,
    failed,
    duration,
    api_calls_used,
    max_api_calls
  } = summary;

  const successRate = total_prompts > 0 
    ? ((successful / total_prompts) * 100).toFixed(1) 
    : 100;

  // Choose emoji based on success
  const emoji = failed === 0 ? '✅' : '⚠️';

  const message = {
    text: `${emoji} Daily Cron Summary - ${date}`,
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `${emoji} Daily Cron Summary - ${date}`,
          emoji: true
        }
      },
      {
        type: "section",
        fields: [
          {
            type: "mrkdwn",
            text: `*Total Prompts:*\n${total_prompts}`
          },
          {
            type: "mrkdwn",
            text: `*✅ Successful:*\n${successful}`
          },
          {
            type: "mrkdwn",
            text: `*❌ Failed:*\n${failed}`
          },
          {
            type: "mrkdwn",
            text: `*Success Rate:*\n${successRate}%`
          },
          {
            type: "mrkdwn",
            text: `*API Calls:*\n${api_calls_used}/${max_api_calls}`
          },
          {
            type: "mrkdwn",
            text: `*Duration:*\n${duration}s`
          }
        ]
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `⏰ Generated at ${new Date().toISOString()}`
          }
        ]
      }
    ]
  };

  try {
    const response = await fetch(SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message)
    });

    if (!response.ok) {
      console.error('[Slack] Failed to send:', response.status);
      return false;
    }

    console.log('[Slack] ✅ Summary sent successfully');
    return true;
  } catch (error) {
    console.error('[Slack] Error:', error.message);
    return false;
  }
}

