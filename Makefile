.PHONY: help dev stop prove docker-up docker-down logs-be logs-fe test test-be test-sc docs build-sc deploy-sc deploy-be deploy-fe

help:
	@echo "CAREL Protocol — local dev commands"
	@echo ""
	@echo "  make dev          Start frontend + backend (uses scripts/quick-start.sh)"
	@echo "  make stop         Stop frontend + backend"
	@echo "  make prove        Start backend with Garaga prover (needs ≥16GB RAM)"
	@echo ""
	@echo "  make docker-up    Start postgres + redis via docker compose"
	@echo "  make docker-down  Stop all docker compose services"
	@echo ""
	@echo "  make test         Run all tests (backend + smartcontract)"
	@echo "  make test-be      Backend Rust tests only"
	@echo "  make test-sc      Cairo/snforge tests only"
	@echo ""
	@echo "  make logs-be      Tail backend log"
	@echo "  make logs-fe      Tail frontend log"
	@echo "  make docs         Start docs site locally"
	@echo ""
	@echo "  make build-sc     Compile Cairo contracts (scarb build)"
	@echo "  make deploy-sc    Build + deploy contracts to Starknet Sepolia (sncast)"
	@echo "  make deploy-be    Deploy backend to Railway (railway up)"
	@echo "  make deploy-fe    Deploy frontend to Vercel (vercel --prod)"

# --- local dev ---

dev:
	@./scripts/quick-start.sh

stop:
	@./scripts/quick-stop.sh

prove:
	@cd backend-rust && bash run-local.sh

docker-up:
	docker compose up -d postgres redis

docker-down:
	docker compose down

logs-be:
	@tail -f .run/backend.log

logs-fe:
	@tail -f .run/frontend.log

# --- testing ---

test: test-be test-sc

test-be:
	@cd backend-rust && CARGO_TARGET_DIR=/tmp/zkcare_target cargo test

test-sc:
	@cd smartcontract/starknet/cairo && snforge test

# --- docs ---

docs:
	@cd docs-site && npm run dev

# --- deployment ---

build-sc:
	@cd smartcontract/starknet/cairo && scarb build

deploy-sc: build-sc
	@cd smartcontract/starknet && bash scripts/deploy.sh

deploy-be:
	@cd backend-rust && railway up

deploy-fe:
	@cd frontend && vercel --prod
