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
    cost_breakdown = {},
    counts_by_engine = {},
    avg_cost_per_prompt_by_engine = {},
    is_estimated = false,
    is_actual = false,
    estimated_cost = 0,
    cost_variance = 0,
    variance_percent = 0
  } = summary;

  const successRate = total_prompts > 0
    ? ((successful / total_prompts) * 100).toFixed(1)
    : 100;

  // Choose emoji based on success and cost type
  const emoji = failed === 0 ? '✅' : '⚠️';
  const costTypeEmoji = is_actual ? '💰' : is_estimated ? '📊' : '💰';
  
  // Determine notification type
  let notificationType = 'Cron Batch Summary';
  if (is_estimated) {
    notificationType = 'Cron Batch Summary (Estimated Costs)';
  } else if (is_actual) {
    notificationType = 'Actual Cost Update';
  }

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
    text: `${costTypeEmoji} ${notificationType} - ${timestamp} UTC`,
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `${costTypeEmoji} ${notificationType} - ${timestamp} UTC`,
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
            text: `*${costTypeEmoji} Total Cost:*\n$${total_cost.toFixed(6)}${is_estimated ? ' (est.)' : is_actual ? ' (actual)' : ''}`
          },
          {
            type: "mrkdwn",
            text: `*📊 Cost/Prompt:*\n$${cost_per_prompt.toFixed(6)}`
          },
          {
            type: "mrkdwn",
            text: `*📈 Avg/Engine:*\n$${avg_cost_per_engine.toFixed(6)}`
          },
          ...(is_actual && estimated_cost > 0 ? [{
            type: "mrkdwn",
            text: `*📈 Variance:*\n$${cost_variance.toFixed(6)} (${variance_percent}%)`
          }, {
            type: "mrkdwn",
            text: `*📊 Estimated:*\n$${estimated_cost.toFixed(6)}`
          }] : []),
          {
            type: "mrkdwn",
            text: `*ChatGPT:* $${(cost_breakdown.chatgpt || 0).toFixed(6)}\n*Google:* $${(cost_breakdown.google || 0).toFixed(6)}`
          },
          {
            type: "mrkdwn",
            text: `*Gemini:* $${(cost_breakdown.gemini || 0).toFixed(6)}\n*Perplexity:* $${(cost_breakdown.perplexity || 0).toFixed(6)}`
          },
          {
            type: "mrkdwn",
            text: `*Claude:* $${(cost_breakdown.claude || 0).toFixed(6)}`
          }
        ]
      },
      ...(is_actual && Object.keys(avg_cost_per_prompt_by_engine).length > 0 ? [{
        type: "divider"
      }, {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "*📊 Average Cost Per Prompt By Engine:*"
        }
      }, {
        type: "section",
        fields: Object.keys(avg_cost_per_prompt_by_engine)
          .filter(engine => (counts_by_engine[engine] || 0) > 0)
          .map(engine => ({
            type: "mrkdwn",
            text: `*${engine.charAt(0).toUpperCase() + engine.slice(1)}:*\n$${avg_cost_per_prompt_by_engine[engine].toFixed(6)}/prompt\n(${counts_by_engine[engine]} results)`
          }))
      }] : []),
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `⏰ Generated at ${new Date().toISOString()} | 🔄 Per-prompt scheduling active${is_estimated ? ' | 📊 Costs are estimates' : is_actual ? ' | 💰 Actual costs from database' : ''}`
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
