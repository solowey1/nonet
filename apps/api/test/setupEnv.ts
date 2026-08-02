process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgres://postgres:postgres@localhost:5432/nonet_test";
process.env.BOT_TOKEN ??= "test-bot-token-000000000000000000000000000";
process.env.JWT_SECRET ??= "test-jwt-secret-at-least-32-characters-long";
process.env.INIT_DATA_MAX_AGE_SECONDS ??= "900";
process.env.INTERNAL_API_SECRET ??= "test-internal-api-secret-1234567890";
