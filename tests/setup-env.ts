/**
 * vitest setupFile — runs before each test module loads, so server config
 * (lazily built from process.env) picks these up. Integration tests get an
 * isolated database and storage dir; unit tests simply ignore them.
 */
process.env.RUN_MODE = 'mock';
process.env.JOBS_INLINE = 'true';
process.env.DATABASE_URL = 'postgres://establo:establo@localhost:5432/establo_test';
process.env.DATA_DIR = 'tests/.tmp-storage';
process.env.ANTHROPIC_API_KEY = '';
process.env.OPENAI_API_KEY = '';
