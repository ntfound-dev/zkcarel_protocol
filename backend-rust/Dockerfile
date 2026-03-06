# syntax=docker/dockerfile:1

FROM rust:1-bookworm AS builder
WORKDIR /app

# Cache dependencies first to speed up rebuilds.
COPY backend-rust/Cargo.toml backend-rust/Cargo.lock ./
RUN mkdir src && printf "fn main() {}\n" > src/main.rs
RUN cargo build --release
RUN rm -rf src

# Build the real backend binary.
COPY backend-rust/src ./src
COPY backend-rust/migrations ./migrations
RUN cargo build --release

FROM debian:bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates libssl3 python3 bash \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /app/target/release/carel-backend /usr/local/bin/carel-backend
COPY backend-rust/scripts ./scripts
COPY backend-rust/garaga_vk.json ./garaga_vk.json
COPY backend-rust/garaga_proof.json ./garaga_proof.json
COPY backend-rust/garaga_public_inputs.json ./garaga_public_inputs.json

ENV RUST_LOG=info
EXPOSE 8080
CMD ["carel-backend"]
