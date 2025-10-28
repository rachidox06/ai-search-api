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
    max_api_calls,
    total_cost = 0,
    cost_per_prompt = 0,
    avg_cost_per_engine = 0,
    cost_breakdown = {}
  } = summary;

  const successRate = total_prompts > 0
    ? ((successful / total_prompts) * 100).toFixed(1)
    : 100;

  // Choose emoji based on success
  const emoji = failed === 0 ? '✅' : '⚠️';

  // Generate timestamp for when this batch ran
  const timestamp = new Date().toLocaleString('en-US', { 
    timeZone: 'UTC', 
    hour12: false,
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  const message = {
    text: `${emoji} Cron Batch Summary - ${timestamp} UTC`,
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `${emoji} Cron Batch Summary - ${timestamp} UTC`,
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
        type: "divider"
      },
      {
        type: "section",
        fields: [
          {
            type: "mrkdwn",
            text: `*💰 Total Cost:*\n$${total_cost.toFixed(4)}`
          },
          {
            type: "mrkdwn",
            text: `*📊 Cost/Prompt:*\n$${cost_per_prompt.toFixed(4)}`
          },
          {
            type: "mrkdwn",
            text: `*📈 Avg/Engine:*\n$${avg_cost_per_engine.toFixed(4)}`
          },
          {
            type: "mrkdwn",
            text: `*ChatGPT:* $${(cost_breakdown.chatgpt || 0).toFixed(4)}\n*Google:* $${(cost_breakdown.google || 0).toFixed(4)}`
          },
          {
            type: "mrkdwn",
            text: `*Gemini:* $${(cost_breakdown.gemini || 0).toFixed(4)}\n*Perplexity:* $${(cost_breakdown.perplexity || 0).toFixed(4)}`
          },
          {
            type: "mrkdwn",
            text: `*Claude:* $${(cost_breakdown.claude || 0).toFixed(4)}`
          }
        ]
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `⏰ Generated at ${new Date().toISOString()} | 🔄 Per-prompt scheduling active`
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
