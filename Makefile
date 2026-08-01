.PHONY: dev test migrate build deploy

# Start Postgres in the background, then every app's dev server in parallel
# (Vite for the web SPA, tsx watch for the api and bot). Ctrl-C stops the lot.
dev:
	docker compose up -d postgres
	pnpm -r --parallel --filter @nonet/web --filter @nonet/api --filter @nonet/bot run dev

# Engine + api's integration suite needs a real Postgres — this brings one
# up if it isn't already running. Point DATABASE_URL elsewhere first if you'd
# rather test against something else.
test:
	docker compose up -d postgres
	pnpm -r --if-present run test

migrate:
	pnpm --filter @nonet/api run migrate

# Topologically ordered by pnpm — engine/shared build before anything that
# bundles or imports them.
build:
	pnpm -r --if-present run build

# Builds every image and (re)starts the full stack, applying migrations on
# api boot (§18). Requires a populated .env — see .env.example.
deploy:
	docker compose up -d --build
