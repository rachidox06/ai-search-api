import dotenv from 'dotenv';
dotenv.config();

export const config = {
  // Redis configuration
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD,
    tls: process.env.REDIS_TLS === 'true' ? { rejectUnauthorized: false } : undefined,
    // Connection resilience settings
    connectTimeout: 30000,           // 30 seconds to connect
    maxRetriesPerRequest: null,      // Required for BullMQ
    retryStrategy: (times: number) => {
      // Exponential backoff with max delay of 5 seconds
      const delay = Math.min(times * 500, 5000);
      console.log(`[Redis] Retry attempt ${times}, waiting ${delay}ms`);
      return delay;
    },
    // Keep connection alive
    keepAlive: 30000,                // Send keepalive every 30 seconds
    enableReadyCheck: true,
    enableOfflineQueue: true,
    // Reconnection settings
    reconnectOnError: (err: Error) => {
      console.error('[Redis] Connection error:', err.message);
      return true; // Always try to reconnect
    },
  },
  
  // Queue configuration
  queue: {
    name: 'brand-extraction-queue',
    concurrency: 10,              // Process 10 jobs in parallel
    maxRetries: 3,
    retryDelay: 2000,             // 2 seconds
  },
  
  // OpenAI configuration
  openai: {
    apiKey: process.env.OPENAI_API_KEY!,
    model: 'gpt-4o-mini',
    temperature: 0.3,
    maxTokens: 2000,
  },
  
  // Supabase configuration
  supabase: {
    url: process.env.SUPABASE_URL!,
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY!, // Use service role key
  },
  
  // Worker configuration
  worker: {
    batchSize: 10,                // Process up to 10 jobs at once
    pollInterval: 100,            // Check for new jobs every 100ms
  }
};

// Validate required env vars
const required = [
  'OPENAI_API_KEY',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'REDIS_HOST'
];

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

