import dotenv from 'dotenv';
dotenv.config();

export const config = {
  // Redis configuration
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD,
    tls: process.env.REDIS_TLS === 'true' ? {} : undefined,
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

