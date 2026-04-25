use axum::{
    response::{Html, IntoResponse},
    Json,
};
use serde_json::{json, Value};

const OPENAPI_VERSION: &str = "3.0.3";
const API_TITLE: &str = "Carel Protocol API";
const API_VERSION: &str = "v1";

pub async fn openapi_json() -> impl IntoResponse {
    Json(build_openapi())
}

pub async fn swagger_ui() -> impl IntoResponse {
    Html(swagger_ui_html("/openapi.json"))
}

pub async fn redoc_ui() -> impl IntoResponse {
    Html(redoc_ui_html("/openapi.json"))
}

pub async fn docs_home() -> impl IntoResponse {
    Html(docs_home_html())
}

fn swagger_ui_html(spec_url: &str) -> String {
    format!(
        r##"<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{title} Docs</title>
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
    <style>
      body {{ margin: 0; background: #0b0f1a; }}
      #swagger-ui {{ max-width: 1200px; margin: 0 auto; padding: 24px; }}
      .topbar {{ display: none; }}
    </style>
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
    <script>
      window.ui = SwaggerUIBundle({{
        url: "{spec_url}",
        dom_id: "#swagger-ui",
        persistAuthorization: true,
        deepLinking: true
      }});
    </script>
  </body>
</html>"##,
        title = API_TITLE,
        spec_url = spec_url
    )
}

fn redoc_ui_html(spec_url: &str) -> String {
    format!(
        r##"<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{title} Reference</title>
    <style>
      body {{ margin: 0; background: #0b0f1a; }}
      redoc {{ display: block; }}
    </style>
  </head>
  <body>
    <redoc spec-url="{spec_url}"></redoc>
    <script src="https://cdn.redoc.ly/redoc/latest/bundles/redoc.standalone.js"></script>
  </body>
</html>"##,
        title = API_TITLE,
        spec_url = spec_url
    )
}

fn docs_home_html() -> String {
    format!(
        r##"<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{title} API Docs</title>
    <style>
      :root {{
        color-scheme: dark;
        font-family: "IBM Plex Sans", "Inter", system-ui, sans-serif;
      }}
      body {{
        margin: 0;
        background: radial-gradient(circle at top, #1c2240, #0b0f1a 65%);
        color: #f5f7ff;
      }}
      .wrap {{
        max-width: 900px;
        margin: 0 auto;
        padding: 64px 24px;
      }}
      h1 {{
        font-size: clamp(2rem, 4vw, 3rem);
        margin-bottom: 8px;
      }}
      p {{
        opacity: 0.78;
        margin-bottom: 24px;
      }}
      .card {{
        background: rgba(255,255,255,0.04);
        border: 1px solid rgba(255,255,255,0.08);
        border-radius: 16px;
        padding: 20px;
        margin-bottom: 16px;
      }}
      a {{
        color: #7bc4ff;
        text-decoration: none;
        font-weight: 600;
      }}
      .links {{
        display: flex;
        gap: 12px;
        flex-wrap: wrap;
      }}
      .pill {{
        display: inline-block;
        padding: 10px 16px;
        border-radius: 999px;
        background: rgba(123,196,255,0.15);
        border: 1px solid rgba(123,196,255,0.35);
      }}
    </style>
  </head>
  <body>
    <div class="wrap">
      <h1>{title} API Docs</h1>
      <p>Quick access to interactive and reference documentation.</p>
      <div class="card">
        <div class="links">
          <a class="pill" href="/docs">Swagger UI</a>
          <a class="pill" href="/redoc">Redoc</a>
          <a class="pill" href="/openapi.json">OpenAPI JSON</a>
        </div>
      </div>
    </div>
  </body>
</html>"##,
        title = API_TITLE
    )
}

fn build_openapi() -> Value {
    let paths = build_paths();
    json!({
        "openapi": OPENAPI_VERSION,
        "info": {
            "title": API_TITLE,
            "version": API_VERSION,
            "description": "Interactive documentation for Carel Protocol API."
        },
        "servers": [
            { "url": "/" }
        ],
        "components": {
            "schemas": {
                "GenericRequest": {
                    "type": "object",
                    "additionalProperties": true
                },
                "GenericResponse": {
                    "type": "object",
                    "properties": {
                        "success": { "type": "boolean" },
                        "data": { "type": "object", "additionalProperties": true }
                    }
                },
                "ErrorResponse": {
                    "type": "object",
                    "properties": {
                        "success": { "type": "boolean" },
                        "error": {
                            "type": "object",
                            "properties": {
                                "code": { "type": "string" },
                                "message": { "type": "string" },
                                "details": { "type": "object", "additionalProperties": true }
                            }
                        }
                    }
                }
            },
            "securitySchemes": {
                "bearerAuth": {
                    "type": "http",
                    "scheme": "bearer",
                    "bearerFormat": "JWT"
                }
            }
        },
        "security": [
            { "bearerAuth": [] }
        ],
        "paths": paths
    })
}

fn build_paths() -> Value {
    let mut paths = serde_json::Map::new();
    for endpoint in endpoints() {
        let path = endpoint.path;
        let method = endpoint.method;
        let operations = paths
            .entry(path.to_string())
            .or_insert_with(|| Value::Object(serde_json::Map::new()));
        if let Value::Object(ref mut map) = operations {
            let mut operation = json!({
                "summary": endpoint.summary,
                "tags": [endpoint.tag],
                "responses": {
                    "200": {
                        "description": "Success",
                        "content": {
                            "application/json": { "schema": { "$ref": "#/components/schemas/GenericResponse" } }
                        }
                    },
                    "400": {
                        "description": "Bad Request",
                        "content": {
                            "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } }
                        }
                    },
                    "401": {
                        "description": "Unauthorized",
                        "content": {
                            "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } }
                        }
                    },
                    "500": {
                        "description": "Server Error",
                        "content": {
                            "application/json": { "schema": { "$ref": "#/components/schemas/ErrorResponse" } }
                        }
                    }
                }
            });

            if endpoint.body {
                if let Value::Object(ref mut op_map) = operation {
                    op_map.insert(
                        "requestBody".to_string(),
                        json!({
                            "required": true,
                            "content": {
                                "application/json": { "schema": { "$ref": "#/components/schemas/GenericRequest" } }
                            }
                        }),
                    );
                }
            }

            if let Value::Object(ref mut op_map) = operation {
                op_map.insert(
                    "x-codeSamples".to_string(),
                    json!([
                        {
                            "lang": "curl",
                            "source": build_curl_sample(&endpoint)
                        }
                    ]),
                );
            }

            map.insert(method.to_string(), operation);
        }
    }
    Value::Object(paths)
}

struct Endpoint {
    method: &'static str,
    path: &'static str,
    summary: &'static str,
    tag: &'static str,
    body: bool,
}

fn build_curl_sample(endpoint: &Endpoint) -> String {
    let mut parts = vec![
        "curl".to_string(),
        "-X".to_string(),
        endpoint.method.to_uppercase(),
        format!("\"http://localhost:3000{}\"", endpoint.path),
    ];
    if endpoint.path.starts_with("/api/") {
        parts.push("-H".to_string());
        parts.push("\"Authorization: Bearer <JWT>\"".to_string());
    }
    if endpoint.body {
        parts.push("-H".to_string());
        parts.push("\"Content-Type: application/json\"".to_string());
        parts.push("-d".to_string());
        parts.push("\"{}\"".to_string());
    }
    parts.join(" ")
}

fn endpoints() -> Vec<Endpoint> {
    vec![
        Endpoint {
            method: "get",
            path: "/health",
            summary: "Health check",
            tag: "Health",
            body: false,
        },
        Endpoint {
            method: "post",
            path: "/api/v1/auth/connect",
            summary: "Connect wallet",
            tag: "Auth",
            body: true,
        },
        Endpoint {
            method: "post",
            path: "/api/v1/auth/refresh",
            summary: "Refresh token",
            tag: "Auth",
            body: true,
        },
        Endpoint {
            method: "get",
            path: "/api/v1/profile/me",
            summary: "Get profile",
            tag: "Profile",
            body: false,
        },
        Endpoint {
            method: "put",
            path: "/api/v1/profile/display-name",
            summary: "Set display name",
            tag: "Profile",
            body: true,
        },
        Endpoint {
            method: "post",
            path: "/api/v1/swap/quote",
            summary: "Swap quote",
            tag: "Swap",
            body: true,
        },
        Endpoint {
            method: "post",
            path: "/api/v1/swap/execute",
            summary: "Execute swap",
            tag: "Swap",
            body: true,
        },
        Endpoint {
            method: "post",
            path: "/api/v1/bridge/quote",
            summary: "Bridge quote",
            tag: "Bridge",
            body: true,
        },
        Endpoint {
            method: "post",
            path: "/api/v1/bridge/execute",
            summary: "Execute bridge",
            tag: "Bridge",
            body: true,
        },
        Endpoint {
            method: "get",
            path: "/api/v1/bridge/status/{bridge_id}",
            summary: "Bridge status",
            tag: "Bridge",
            body: false,
        },
        Endpoint {
            method: "get",
            path: "/api/v1/garden/volume",
            summary: "Garden volume",
            tag: "Garden",
            body: false,
        },
        Endpoint {
            method: "get",
            path: "/api/v1/garden/fees",
            summary: "Garden fees",
            tag: "Garden",
            body: false,
        },
        Endpoint {
            method: "get",
            path: "/api/v1/garden/chains",
            summary: "Garden chains",
            tag: "Garden",
            body: false,
        },
        Endpoint {
            method: "get",
            path: "/api/v1/garden/assets",
            summary: "Garden assets",
            tag: "Garden",
            body: false,
        },
        Endpoint {
            method: "get",
            path: "/api/v1/garden/liquidity",
            summary: "Garden liquidity",
            tag: "Garden",
            body: false,
        },
        Endpoint {
            method: "get",
            path: "/api/v1/garden/orders",
            summary: "Garden orders",
            tag: "Garden",
            body: false,
        },
        Endpoint {
            method: "get",
            path: "/api/v1/garden/orders/{order_id}",
            summary: "Garden order by id",
            tag: "Garden",
            body: false,
        },
        Endpoint {
            method: "get",
            path: "/api/v1/garden/orders/{order_id}/instant-refund-hash",
            summary: "Garden order refund hash",
            tag: "Garden",
            body: false,
        },
        Endpoint {
            method: "get",
            path: "/api/v1/garden/schemas/{name}",
            summary: "Garden schema",
            tag: "Garden",
            body: false,
        },
        Endpoint {
            method: "get",
            path: "/api/v1/garden/apps/earnings",
            summary: "Garden app earnings",
            tag: "Garden",
            body: false,
        },
        Endpoint {
            method: "post",
            path: "/api/v1/limit-order/create",
            summary: "Create limit order",
            tag: "Limit Order",
            body: true,
        },
        Endpoint {
            method: "get",
            path: "/api/v1/limit-order/list",
            summary: "List limit orders",
            tag: "Limit Order",
            body: false,
        },
        Endpoint {
            method: "delete",
            path: "/api/v1/limit-order/{order_id}",
            summary: "Cancel limit order",
            tag: "Limit Order",
            body: false,
        },
        Endpoint {
            method: "get",
            path: "/api/v1/stake/pools",
            summary: "Stake pools",
            tag: "Stake",
            body: false,
        },
        Endpoint {
            method: "post",
            path: "/api/v1/stake/deposit",
            summary: "Stake deposit",
            tag: "Stake",
            body: true,
        },
        Endpoint {
            method: "post",
            path: "/api/v1/stake/withdraw",
            summary: "Stake withdraw",
            tag: "Stake",
            body: true,
        },
        Endpoint {
            method: "post",
            path: "/api/v1/stake/claim",
            summary: "Stake claim",
            tag: "Stake",
            body: true,
        },
        Endpoint {
            method: "get",
            path: "/api/v1/stake/positions",
            summary: "Stake positions",
            tag: "Stake",
            body: false,
        },
        Endpoint {
            method: "get",
            path: "/api/v1/portfolio/balance",
            summary: "Portfolio balance",
            tag: "Portfolio",
            body: false,
        },
        Endpoint {
            method: "get",
            path: "/api/v1/portfolio/history",
            summary: "Portfolio history",
            tag: "Portfolio",
            body: false,
        },
        Endpoint {
            method: "get",
            path: "/api/v1/portfolio/ohlcv",
            summary: "Portfolio OHLCV",
            tag: "Portfolio",
            body: false,
        },
        Endpoint {
            method: "post",
            path: "/api/v1/wallet/onchain-balances",
            summary: "Wallet balances",
            tag: "Wallet",
            body: true,
        },
        Endpoint {
            method: "post",
            path: "/api/v1/wallet/link",
            summary: "Link wallet",
            tag: "Wallet",
            body: true,
        },
        Endpoint {
            method: "delete",
            path: "/api/v1/wallet/unlink",
            summary: "Unlink wallet",
            tag: "Wallet",
            body: false,
        },
        Endpoint {
            method: "get",
            path: "/api/v1/wallet/linked",
            summary: "Get linked wallets",
            tag: "Wallet",
            body: false,
        },
        Endpoint {
            method: "get",
            path: "/api/v1/portfolio/analytics",
            summary: "Portfolio analytics",
            tag: "Analytics",
            body: false,
        },
        Endpoint {
            method: "get",
            path: "/api/v1/analytics/system-health",
            summary: "System health",
            tag: "Analytics",
            body: false,
        },
        Endpoint {
            method: "get",
            path: "/api/v1/leaderboard/{type}",
            summary: "Leaderboard",
            tag: "Leaderboard",
            body: false,
        },
        Endpoint {
            method: "get",
            path: "/api/v1/leaderboard/global",
            summary: "Leaderboard global",
            tag: "Leaderboard",
            body: false,
        },
        Endpoint {
            method: "get",
            path: "/api/v1/leaderboard/global/{epoch}",
            summary: "Leaderboard epoch",
            tag: "Leaderboard",
            body: false,
        },
        Endpoint {
            method: "get",
            path: "/api/v1/leaderboard/user/{address}",
            summary: "Leaderboard user rank",
            tag: "Leaderboard",
            body: false,
        },
        Endpoint {
            method: "get",
            path: "/api/v1/leaderboard/user/{address}/categories",
            summary: "Leaderboard user categories",
            tag: "Leaderboard",
            body: false,
        },
        Endpoint {
            method: "get",
            path: "/api/v1/rewards/points",
            summary: "Rewards points",
            tag: "Rewards",
            body: false,
        },
        Endpoint {
            method: "post",
            path: "/api/v1/rewards/sync-onchain",
            summary: "Sync rewards onchain",
            tag: "Rewards",
            body: true,
        },
        Endpoint {
            method: "post",
            path: "/api/v1/rewards/claim",
            summary: "Claim rewards",
            tag: "Rewards",
            body: true,
        },
        Endpoint {
            method: "post",
            path: "/api/v1/rewards/convert",
            summary: "Convert to CAREL",
            tag: "Rewards",
            body: true,
        },
        Endpoint {
            method: "post",
            path: "/api/v1/nft/mint",
            summary: "Mint NFT",
            tag: "NFT",
            body: true,
        },
        Endpoint {
            method: "get",
            path: "/api/v1/nft/status/{tx_hash}",
            summary: "NFT status",
            tag: "NFT",
            body: false,
        },
        Endpoint {
            method: "get",
            path: "/api/v1/nft/owned",
            summary: "Owned NFTs",
            tag: "NFT",
            body: false,
        },
        Endpoint {
            method: "get",
            path: "/api/v1/referral/code",
            summary: "Referral code",
            tag: "Referral",
            body: false,
        },
        Endpoint {
            method: "get",
            path: "/api/v1/referral/stats",
            summary: "Referral stats",
            tag: "Referral",
            body: false,
        },
        Endpoint {
            method: "get",
            path: "/api/v1/referral/history",
            summary: "Referral history",
            tag: "Referral",
            body: false,
        },
        Endpoint {
            method: "get",
            path: "/api/v1/social/tasks",
            summary: "Social tasks",
            tag: "Social",
            body: false,
        },
        Endpoint {
            method: "post",
            path: "/api/v1/social/verify",
            summary: "Verify social task",
            tag: "Social",
            body: true,
        },
        Endpoint {
            method: "post",
            path: "/api/v1/admin/points/reset",
            summary: "Admin reset points",
            tag: "Admin",
            body: true,
        },
        Endpoint {
            method: "post",
            path: "/api/v1/privacy/submit",
            summary: "Submit private action",
            tag: "Privacy",
            body: true,
        },
        Endpoint {
            method: "post",
            path: "/api/v1/privacy/auto-submit",
            summary: "Auto submit private action",
            tag: "Privacy",
            body: true,
        },
        Endpoint {
            method: "post",
            path: "/api/v1/privacy/prepare-private-execution",
            summary: "Prepare private execution",
            tag: "Privacy",
            body: true,
        },
        Endpoint {
            method: "post",
            path: "/api/v1/privacy/prepare-private-exit",
            summary: "Prepare private exit",
            tag: "Privacy",
            body: true,
        },
        Endpoint {
            method: "post",
            path: "/api/v1/privacy/fixed-amount",
            summary: "Get private fixed amount",
            tag: "Privacy",
            body: true,
        },
        Endpoint {
            method: "post",
            path: "/api/v1/privacy/relayer-execute",
            summary: "Relay private execution",
            tag: "Privacy",
            body: true,
        },
        Endpoint {
            method: "post",
            path: "/api/v1/private-btc-swap/initiate",
            summary: "Initiate private BTC swap",
            tag: "Private BTC Swap",
            body: true,
        },
        Endpoint {
            method: "post",
            path: "/api/v1/private-btc-swap/finalize",
            summary: "Finalize private BTC swap",
            tag: "Private BTC Swap",
            body: true,
        },
        Endpoint {
            method: "get",
            path: "/api/v1/private-btc-swap/order/{swap_id}",
            summary: "Private BTC swap order",
            tag: "Private BTC Swap",
            body: false,
        },
        Endpoint {
            method: "get",
            path: "/api/v1/private-btc-swap/nullifier/{nullifier}",
            summary: "Private BTC swap nullifier",
            tag: "Private BTC Swap",
            body: false,
        },
        Endpoint {
            method: "post",
            path: "/api/v1/faucet/claim",
            summary: "Faucet claim",
            tag: "Faucet",
            body: true,
        },
        Endpoint {
            method: "get",
            path: "/api/v1/faucet/status",
            summary: "Faucet status",
            tag: "Faucet",
            body: false,
        },
        Endpoint {
            method: "get",
            path: "/api/v1/faucet/stats",
            summary: "Faucet stats",
            tag: "Faucet",
            body: false,
        },
        Endpoint {
            method: "post",
            path: "/api/v1/deposit/bank-transfer",
            summary: "Bank transfer deposit",
            tag: "Deposit",
            body: true,
        },
        Endpoint {
            method: "post",
            path: "/api/v1/deposit/qris",
            summary: "QRIS deposit",
            tag: "Deposit",
            body: true,
        },
        Endpoint {
            method: "post",
            path: "/api/v1/deposit/card",
            summary: "Card deposit",
            tag: "Deposit",
            body: true,
        },
        Endpoint {
            method: "get",
            path: "/api/v1/deposit/status/{id}",
            summary: "Deposit status",
            tag: "Deposit",
            body: false,
        },
        Endpoint {
            method: "get",
            path: "/api/v1/notifications/list",
            summary: "Notifications list",
            tag: "Notifications",
            body: false,
        },
        Endpoint {
            method: "post",
            path: "/api/v1/notifications/mark-read",
            summary: "Mark notifications read",
            tag: "Notifications",
            body: true,
        },
        Endpoint {
            method: "put",
            path: "/api/v1/notifications/preferences",
            summary: "Update notification preferences",
            tag: "Notifications",
            body: true,
        },
        Endpoint {
            method: "get",
            path: "/api/v1/notifications/stats",
            summary: "Notifications stats",
            tag: "Notifications",
            body: false,
        },
        Endpoint {
            method: "get",
            path: "/api/v1/transactions/history",
            summary: "Transaction history",
            tag: "Transactions",
            body: false,
        },
        Endpoint {
            method: "get",
            path: "/api/v1/transactions/history-cursor",
            summary: "Transaction history cursor",
            tag: "Transactions",
            body: false,
        },
        Endpoint {
            method: "get",
            path: "/api/v1/transactions/{tx_hash}",
            summary: "Transaction detail",
            tag: "Transactions",
            body: false,
        },
        Endpoint {
            method: "post",
            path: "/api/v1/transactions/export",
            summary: "Export transactions CSV",
            tag: "Transactions",
            body: true,
        },
        Endpoint {
            method: "get",
            path: "/api/v1/chart/{token}/ohlcv",
            summary: "Chart OHLCV",
            tag: "Charts",
            body: false,
        },
        Endpoint {
            method: "get",
            path: "/api/v1/chart/{token}/indicators",
            summary: "Chart indicators",
            tag: "Charts",
            body: false,
        },
        Endpoint {
            method: "get",
            path: "/api/v1/market/depth/{token}",
            summary: "Market depth",
            tag: "Market",
            body: false,
        },
        Endpoint {
            method: "post",
            path: "/api/v1/webhooks/register",
            summary: "Register webhook",
            tag: "Webhooks",
            body: true,
        },
        Endpoint {
            method: "get",
            path: "/api/v1/webhooks/list",
            summary: "List webhooks",
            tag: "Webhooks",
            body: false,
        },
        Endpoint {
            method: "delete",
            path: "/api/v1/webhooks/{id}",
            summary: "Delete webhook",
            tag: "Webhooks",
            body: false,
        },
        Endpoint {
            method: "get",
            path: "/api/v1/webhooks/logs",
            summary: "Webhook logs",
            tag: "Webhooks",
            body: false,
        },
        Endpoint {
            method: "post",
            path: "/api/v1/ai/prepare-action",
            summary: "AI prepare action",
            tag: "AI",
            body: true,
        },
        Endpoint {
            method: "get",
            path: "/api/v1/ai/level",
            summary: "AI level",
            tag: "AI",
            body: false,
        },
        Endpoint {
            method: "post",
            path: "/api/v1/ai/upgrade",
            summary: "AI upgrade",
            tag: "AI",
            body: true,
        },
        Endpoint {
            method: "get",
            path: "/api/v1/ai/config",
            summary: "AI config",
            tag: "AI",
            body: false,
        },
        Endpoint {
            method: "post",
            path: "/api/v1/ai/ensure-executor",
            summary: "AI ensure executor",
            tag: "AI",
            body: true,
        },
        Endpoint {
            method: "post",
            path: "/api/v1/ai/execute",
            summary: "AI execute command",
            tag: "AI",
            body: true,
        },
        Endpoint {
            method: "get",
            path: "/api/v1/ai/pending",
            summary: "AI pending actions",
            tag: "AI",
            body: false,
        },
        Endpoint {
            method: "post",
            path: "/api/v1/battleship/create",
            summary: "Battleship create",
            tag: "Battleship",
            body: true,
        },
        Endpoint {
            method: "post",
            path: "/api/v1/battleship/join",
            summary: "Battleship join",
            tag: "Battleship",
            body: true,
        },
        Endpoint {
            method: "post",
            path: "/api/v1/battleship/place-ships",
            summary: "Battleship place ships",
            tag: "Battleship",
            body: true,
        },
        Endpoint {
            method: "post",
            path: "/api/v1/battleship/fire",
            summary: "Battleship fire",
            tag: "Battleship",
            body: true,
        },
        Endpoint {
            method: "post",
            path: "/api/v1/battleship/respond",
            summary: "Battleship respond",
            tag: "Battleship",
            body: true,
        },
        Endpoint {
            method: "post",
            path: "/api/v1/battleship/claim-timeout",
            summary: "Battleship claim timeout",
            tag: "Battleship",
            body: true,
        },
        Endpoint {
            method: "get",
            path: "/api/v1/battleship/state/{game_id}",
            summary: "Battleship state",
            tag: "Battleship",
            body: false,
        },
        Endpoint {
            method: "get",
            path: "/ws/notifications",
            summary: "WebSocket notifications",
            tag: "WebSocket",
            body: false,
        },
        Endpoint {
            method: "get",
            path: "/ws/prices",
            summary: "WebSocket prices",
            tag: "WebSocket",
            body: false,
        },
        Endpoint {
            method: "get",
            path: "/ws/orders",
            summary: "WebSocket orders",
            tag: "WebSocket",
            body: false,
        },
    ]
}
