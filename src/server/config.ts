import 'dotenv/config';

export type RunMode = 'mock' | 'sandbox' | 'production';

function bool(v: string | undefined, dflt: boolean): boolean {
  if (v === undefined || v === '') return dflt;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

function buildConfig(env: NodeJS.ProcessEnv) {
  const runMode = (env.RUN_MODE ?? 'mock') as RunMode;
  if (!['mock', 'sandbox', 'production'].includes(runMode)) {
    throw new Error(`Invalid RUN_MODE "${env.RUN_MODE}" — expected mock|sandbox|production`);
  }

  const sessionSecret = env.SESSION_SECRET || 'establo-dev-only-secret-do-not-use-in-prod';
  if (runMode !== 'mock' && !env.SESSION_SECRET) {
    throw new Error('SESSION_SECRET is required outside mock mode (openssl rand -hex 32)');
  }

  return {
    runMode,
    isMock: runMode === 'mock',
    isProduction: runMode === 'production',
    port: Number(env.PORT ?? 8787),
    publicBaseUrl: (env.PUBLIC_BASE_URL ?? 'http://localhost:8787').replace(/\/$/, ''),
    sessionSecret,
    dataDir: env.DATA_DIR ?? './data/storage',
    databaseUrl: env.DATABASE_URL ?? 'postgres://establo:establo@localhost:5432/establo',

    anthropicApiKey: env.ANTHROPIC_API_KEY || undefined,
    anthropicModel: env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-20250514',

    openaiApiKey: env.OPENAI_API_KEY || undefined,
    openaiEmbeddingModel: env.OPENAI_EMBEDDING_MODEL ?? 'text-embedding-3-small',
    openaiWhisperModel: env.OPENAI_WHISPER_MODEL ?? 'whisper-1',
    openaiTtsModel: env.OPENAI_TTS_MODEL ?? 'tts-1',
    openaiTtsVoice: env.OPENAI_TTS_VOICE ?? 'nova',

    twilioAccountSid: env.TWILIO_ACCOUNT_SID || undefined,
    twilioAuthToken: env.TWILIO_AUTH_TOKEN || undefined,
    twilioWhatsAppFrom: env.TWILIO_WHATSAPP_FROM ?? 'whatsapp:+14155238886',
    twilioValidateSignature: bool(env.TWILIO_VALIDATE_SIGNATURE, runMode === 'production'),
    // Twilio Content template SIDs, issued once Meta approves each template.
    // Required for proactive drip in production; undefined in mock/dev.
    twilioContentSidModuleNotify: env.TWILIO_CONTENT_SID_MODULE_NOTIFY || undefined,
    twilioContentSidCheckReminder: env.TWILIO_CONTENT_SID_CHECK_REMINDER || undefined,

    retrievalTopK: Number(env.RETRIEVAL_TOP_K ?? 6),
    retrievalMinSimilarity: env.RETRIEVAL_MIN_SIMILARITY
      ? Number(env.RETRIEVAL_MIN_SIMILARITY)
      : undefined,

    dripCron: env.DRIP_CRON ?? '*/15 * * * *',
    jobsInline: bool(env.JOBS_INLINE, false),

    // SMS fallback seam for paused WhatsApp templates (stub transport only).
    smsFallbackEnabled: bool(env.SMS_FALLBACK_ENABLED, false),

    enableBilling: bool(env.ENABLE_BILLING, false),
    stripeSecretKey: env.STRIPE_SECRET_KEY || undefined,
    stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET || undefined,
    stripePriceBase: env.STRIPE_PRICE_BASE || undefined,
    stripePricePerCow: env.STRIPE_PRICE_PER_COW || undefined,
  };
}

export type Config = ReturnType<typeof buildConfig>;

let cached: Config | undefined;

/** Lazily-built so tests can set process.env before first use. */
export function config(): Config {
  if (!cached) cached = buildConfig(process.env);
  return cached;
}

export function resetConfigForTests(): void {
  cached = undefined;
}
