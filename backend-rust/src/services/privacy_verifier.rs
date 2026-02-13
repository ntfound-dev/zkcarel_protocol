use crate::{config::Config, error::AppError, error::Result};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PrivacyVerifierKind {
    Garaga,
    Tongo,
    Semaphore,
}

impl PrivacyVerifierKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Garaga => "garaga",
            Self::Tongo => "tongo",
            Self::Semaphore => "semaphore",
        }
    }
}

pub fn parse_privacy_verifier_kind(raw: Option<&str>) -> Result<PrivacyVerifierKind> {
    let Some(value) = raw.map(str::trim).filter(|v| !v.is_empty()) else {
        return Ok(PrivacyVerifierKind::Garaga);
    };

    match value.to_ascii_lowercase().as_str() {
        "garaga" => Ok(PrivacyVerifierKind::Garaga),
        "tongo" => Ok(PrivacyVerifierKind::Tongo),
        "semaphore" | "sema" => Ok(PrivacyVerifierKind::Semaphore),
        other => Err(AppError::BadRequest(format!(
            "Unsupported privacy verifier '{}'. Use garaga|tongo|semaphore.",
            other
        ))),
    }
}

pub fn resolve_privacy_router_for_verifier(
    config: &Config,
    kind: PrivacyVerifierKind,
) -> Result<String> {
    if let Some(router) = config.privacy_router_for_verifier(kind.as_str()) {
        let trimmed = router.trim();
        if is_valid_router_address(trimmed) {
            return Ok(trimmed.to_string());
        }
    }

    if kind == PrivacyVerifierKind::Garaga {
        let fallback = config.zk_privacy_router_address.trim();
        if is_valid_router_address(fallback) {
            return Ok(fallback.to_string());
        }
    }

    Err(AppError::BadRequest(format!(
        "Router for verifier '{}' is not configured. Set PRIVACY_VERIFIER_ROUTERS, e.g. garaga:0x...,tongo:0x...,semaphore:0x...",
        kind.as_str()
    )))
}

fn is_valid_router_address(address: &str) -> bool {
    !address.is_empty() && address.starts_with("0x") && !address.starts_with("0x0000")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_defaults_to_garaga() {
        assert_eq!(
            parse_privacy_verifier_kind(None).expect("must parse"),
            PrivacyVerifierKind::Garaga
        );
        assert_eq!(
            parse_privacy_verifier_kind(Some("")).expect("must parse"),
            PrivacyVerifierKind::Garaga
        );
    }

    #[test]
    fn parse_accepts_supported_values() {
        assert_eq!(
            parse_privacy_verifier_kind(Some("tongo")).expect("must parse"),
            PrivacyVerifierKind::Tongo
        );
        assert_eq!(
            parse_privacy_verifier_kind(Some("sema")).expect("must parse"),
            PrivacyVerifierKind::Semaphore
        );
    }

    #[test]
    fn parse_rejects_unknown_value() {
        let result = parse_privacy_verifier_kind(Some("unknown"));
        assert!(result.is_err());
    }
}
