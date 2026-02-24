# AI Architecture Diagram

## 1) Component Architecture

```mermaid
flowchart LR
    subgraph Client
        U[User]
        FE[Floating AI Assistant<br/>frontend/components/floating-ai-assistant.tsx]
        API[API Client<br/>frontend/lib/api.ts]
        W1[Starknet Wallet<br/>Argent / Ready]
        W2[BTC Wallet<br/>UniSat / Xverse]
        U --> FE --> API
    end

    subgraph Backend["backend-rust (Axum)"]
        AX[AI + Bridge Endpoints<br/>/ai/prepare-action<br/>/ai/pending<br/>/ai/execute<br/>/bridge/execute]
        AIS[AIService<br/>Intent Parser + Guard + Optional LLM]
        REDIS[(Redis<br/>Rate Limit + Setup Cache + Action Consumed)]
        DB[(PostgreSQL<br/>Users, Wallet Links, AI Level,<br/>Transactions, NFT Discount State, Points)]
        BG[Background Workers<br/>Event Indexer + Point Calculator]
        API --> AX
        AX --> AIS
        AX --> REDIS
        AX --> DB
        BG --> DB
    end

    subgraph LLM["LLM Providers (Optional)"]
        L1[Groq / OpenAI-compatible]
        L2[OpenAI]
        L3[Gemini]
        L4[Cairo Coder]
        AIS --> L1
        AIS --> L2
        AIS --> L3
        AIS --> L4
    end

    subgraph Chain["Starknet + External"]
        RPC[Starknet RPC Pool<br/>Infura / ZAN / OnFinality]
        V[AI Signature Verifier Contract]
        E[AI Executor Contract]
        C[CAREL Token Contract]
        N[NFT Discount Contract]
        B[Bridge Providers<br/>Garden / LayerSwap / Atomiq]
    end

    AX --> RPC
    AX --> V
    AX --> E
    AX --> C
    AX --> N
    AX --> B

    FE --> W1
    FE --> W2
    W1 --> RPC
```

## 2) AI Execution Flow (Setup + Execute)

```mermaid
sequenceDiagram
    autonumber
    participant User
    participant FE as Frontend Assistant
    participant BE as Backend AI API
    participant Verifier as AI Signature Verifier
    participant Wallet as Starknet Wallet
    participant Executor as AI Executor
    participant Bridge as Bridge API/Provider

    User->>FE: Send command (swap/bridge/stake)
    FE->>BE: POST /ai/prepare-action
    BE->>Verifier: set_valid_hash window
    BE-->>FE: action window prepared

    FE->>Wallet: Sign approve + submit_action
    Wallet->>Executor: submit_action(action_type, params, user_signature)
    Executor-->>FE: action_id pending

    FE->>BE: POST /ai/execute (with action_id)
    BE->>BE: Guard scope + AIService parse/rewrite
    alt Executable command
        BE->>Executor: execute_action(action_id) via backend signer
        BE-->>FE: AI response + actions/data
    else Not executable or timeout
        BE-->>FE: retry/info response (action not consumed)
    end

    opt Bridge command
        FE->>Bridge: POST /bridge/execute (with signed tx hash)
        Bridge-->>FE: bridge order + deposit address
    end
```

## 3) Points + Discount Rules

- Point sources in calculator:
  - `swap` -> points enabled
  - `limit_order` -> points enabled
  - `stake` -> points enabled
  - `bridge` -> points enabled
- NFT discount is validated at submit-time and persisted in local state.
- Bridge points include NFT multiplier and AI level bonus:
  - Level 2: +2%
  - Level 3: +5%
- Final point settlement is handled by background workers after transaction indexing.
