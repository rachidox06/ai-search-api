# AI Search Cron Scheduler

Automatically refreshes all active prompts once per day by calling the AI search API.

## What It Does

1. Runs on a schedule (default: 2 AM daily)
2. Fetches all prompts where `is_active = true` from Supabase
3. Calls `/api/v1/prompt-runs/batch` for each prompt with all 4 engines
4. Respects API call limits (default: 500 calls = 125 prompts max)
5. Logs progress and results

## Railway Setup

### Step 1: Create New Service

1. Go to your Railway dashboard
2. Click **"New Service"**
3. Select **"From GitHub"** (or your git provider)
4. Choose your `ai-search-api` repository
5. Set **Root Directory** to: `cron-scheduler`

### Step 2: Add Environment Variables

In Railway's service settings, add these variables:

**Required:**
- `SUPABASE_URL` - Your Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` - Your Supabase service role key (not anon key!)
- `API_URL` - Your main API URL (e.g., `https://your-api.railway.app`)

**Optional:**
- `CRON_SCHEDULE` - When to run (default: `0 2 * * *` = 2 AM daily)
- `MAX_API_CALLS_PER_RUN` - Safety limit (default: `500`)
- `SKIP_INITIAL_RUN` - Set to `true` to skip run on startup (default: `false`)

### Step 3: Deploy

Railway will automatically:
- Detect the Dockerfile
- Build the container
- Deploy the service
- Start the cron scheduler

**Note:** The cron will run immediately on first deploy (unless `SKIP_INITIAL_RUN=true`), then run on schedule.

## Configuration

### Cron Schedule Examples

Standard cron syntax: `minute hour day month weekday`

- `0 2 * * *` - Every day at 2:00 AM (default)
- `0 */6 * * *` - Every 6 hours
- `0 0 * * 1` - Every Monday at midnight
- `0 12 * * *` - Every day at noon

### API Call Limits

With 4 engines per prompt:
- `MAX_API_CALLS_PER_RUN=500` → 125 prompts max
- `MAX_API_CALLS_PER_RUN=400` → 100 prompts max
- `MAX_API_CALLS_PER_RUN=1000` → 250 prompts max

## Monitoring in Railway

View the **Logs** tab in your Railway service to see:
- ✅ Number of active prompts found
- 📤 Each prompt being processed
- ✅/❌ Success/failure for each request
- 📊 Daily summary with totals and API calls used

## Troubleshooting

| Problem | Solution |
|---------|----------|
| **No prompts found** | Check `is_active` column in Supabase prompts table |
| **API errors** | Verify `API_URL` is correct and main API is running |
| **Cron not running** | Check Railway logs for errors, verify `CRON_SCHEDULE` syntax |
| **Hitting limits** | Reduce `MAX_API_CALLS_PER_RUN` or deactivate some prompts |

## Testing Before Production

Set `DRY_RUN=true` in Railway to test without making actual API calls. Check logs to verify it finds your prompts correctly.

