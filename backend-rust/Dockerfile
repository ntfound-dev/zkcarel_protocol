# syntax=docker/dockerfile:1

FROM rust:1-bookworm AS builder
WORKDIR /app/backend-rust

# Build backend from full real sources to avoid stale dummy binaries from cache.
COPY Cargo.toml Cargo.lock ./
COPY src ./src
COPY migrations ./migrations
COPY scripts ./scripts
RUN cargo build --release --bin carel-backend
RUN cargo build --release --bin garaga_auto_prover
RUN cargo build --release --bin filecoin_synapse

FROM node:20-bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates libssl3 python3 python3-pip bash redis-tools curl \
    && pip3 install --break-system-packages --no-cache-dir uv \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /app/backend-rust/target/release/carel-backend /usr/local/bin/carel-backend
COPY --from=builder /app/backend-rust/target/release/garaga_auto_prover /usr/local/bin/garaga_auto_prover
COPY --from=builder /app/backend-rust/target/release/filecoin_synapse /usr/local/bin/filecoin_synapse
COPY scripts/package.json ./scripts/package.json
RUN cd /app/scripts && npm install --omit=dev
COPY scripts ./scripts
COPY garaga_honk_vk ./garaga_honk_vk

ENV RUST_LOG=info
ENV PORT=8080
EXPOSE 8080
CMD ["carel-backend"]
