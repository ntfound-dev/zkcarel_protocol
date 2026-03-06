# syntax=docker/dockerfile:1

FROM rust:1-bookworm AS builder
WORKDIR /app/backend-rust

# Build backend from full real sources to avoid stale dummy binaries from cache.
COPY backend-rust/Cargo.toml backend-rust/Cargo.lock ./
COPY backend-rust/src ./src
COPY backend-rust/migrations ./migrations
COPY backend-rust/scripts ./scripts
COPY backend-rust/garaga-real-prover ./garaga-real-prover
RUN cargo build --release --bin carel-backend

# Build the Garaga real prover binary used by Hide Mode.
RUN cargo build --manifest-path garaga-real-prover/Cargo.toml --release

FROM debian:bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates libssl3 python3 python3-pip bash redis-tools \
    && pip3 install --break-system-packages --no-cache-dir uv \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /app/backend-rust/target/release/carel-backend /usr/local/bin/carel-backend
COPY backend-rust/scripts ./scripts
COPY backend-rust/garaga-real-prover ./garaga-real-prover
RUN mkdir -p /app/garaga-real-prover/target/release
COPY --from=builder /app/backend-rust/garaga-real-prover/target/release/garaga-real-prover /app/garaga-real-prover/target/release/garaga-real-prover
COPY backend-rust/garaga_proving_key.bin ./garaga_proving_key.bin
COPY backend-rust/garaga_vk.json ./garaga_vk.json
COPY backend-rust/garaga_proof.json ./garaga_proof.json
COPY backend-rust/garaga_public_inputs.json ./garaga_public_inputs.json

ENV RUST_LOG=info
ENV PORT=8080
EXPOSE 8080
CMD ["carel-backend"]
