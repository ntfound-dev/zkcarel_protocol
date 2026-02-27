param(
    [string]$RepoRoot = "C:\Users\frend\zkcare_protocol",
    [string]$Account = "sepolia",
    [int]$WaitTimeout = 1800,
    [int]$WaitRetryInterval = 10,
    [switch]$SkipDeclare = $false,
    [string]$ClassHash = "",
    [switch]$UseWsl = $false,
    [string]$WslSncastPath = "/home/frend/.asdf/installs/starknet-foundry/0.56.0/bin/sncast",
    [string]$WslScarbPath = "/home/frend/.asdf/installs/scarb/2.11.4/bin/scarb",
    [string]$WslUscPath = "/home/frend/.local/bin/universal-sierra-compiler"
)

$ErrorActionPreference = "Stop"
# Prevent native stderr lines (e.g. compiler warnings/progress) from becoming
# terminating errors in PowerShell during long-running sncast commands.
if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
    $PSNativeCommandUseErrorActionPreference = $false
}

function Load-EnvFile {
    param([string]$Path)
    if (-not (Test-Path $Path)) {
        throw "Env file not found: $Path"
    }
    Get-Content $Path | ForEach-Object {
        $line = $_.Trim()
        if ($line -eq "" -or $line.StartsWith("#")) {
            return
        }
        $parts = $line.Split("=", 2)
        if ($parts.Length -ne 2) {
            return
        }
        $key = $parts[0].Trim()
        $value = $parts[1].Trim().Trim('"')
        [System.Environment]::SetEnvironmentVariable($key, $value, "Process")
    }
}

function Update-EnvFile {
    param(
        [string]$Path,
        [string]$Key,
        [string]$Value
    )
    $raw = Get-Content $Path
    $updated = $false
    for ($i = 0; $i -lt $raw.Length; $i++) {
        if ($raw[$i] -match "^\Q$Key\E=") {
            $raw[$i] = "$Key=$Value"
            $updated = $true
            break
        }
    }
    if (-not $updated) {
        $raw += "$Key=$Value"
    }
    Set-Content -Path $Path -Value $raw
}

function Parse-HexFromOutput {
    param(
        [string]$Text,
        [string]$Label
    )
    $pattern = "$Label\s*:\s*(0x[0-9a-fA-F]+)"
    $match = [regex]::Match($Text, $pattern, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
    if ($match.Success) {
        return $match.Groups[1].Value
    }
    return ""
}

function Convert-WindowsPathToWsl {
    param([string]$Path)
    $normalized = $Path -replace "\\", "/"
    if ($normalized -match "^([A-Za-z]):/(.*)$") {
        $drive = $matches[1].ToLower()
        $rest = $matches[2]
        return "/mnt/$drive/$rest"
    }
    return $normalized
}

function Get-WslDirName {
    param([string]$Path)
    if ($Path -match "^(.*)/[^/]+$") {
        return $matches[1]
    }
    return "."
}

function Invoke-Sncast {
    param(
        [string[]]$CmdArgs,
        [string]$WorkingDir
    )
    if ($UseWsl) {
        $wslDir = Convert-WindowsPathToWsl -Path $WorkingDir
        $wslSncastDir = Get-WslDirName -Path $WslSncastPath
        $wslScarbDir = Get-WslDirName -Path $WslScarbPath
        $wslUscDir = Get-WslDirName -Path $WslUscPath
        $wslPath = "$wslSncastDir`:$wslScarbDir`:$wslUscDir`:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
        $prevEap = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        try {
            $output = & wsl --cd $wslDir -- env "PATH=$wslPath" "SCARB=$WslScarbPath" "UNIVERSAL_SIERRA_COMPILER=$WslUscPath" $WslSncastPath @CmdArgs 2>&1 | Out-String
        }
        finally {
            $ErrorActionPreference = $prevEap
        }
        if ($LASTEXITCODE -ne 0) {
            throw "sncast failed (WSL path: $WslSncastPath).`n$output"
        }
        return $output
    }

    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $output = & sncast @CmdArgs 2>&1 | Out-String
    }
    finally {
        $ErrorActionPreference = $prevEap
    }
    if ($LASTEXITCODE -ne 0) {
        throw "sncast failed.`n$output"
    }
    return $output
}

$smartcontractDir = Join-Path $RepoRoot "smartcontract"
$regenDir = Join-Path $smartcontractDir "garaga_real_bls_regen"
$envPath = Join-Path $smartcontractDir ".env"

Load-EnvFile -Path $envPath

if (-not $env:RPC_URL) {
    throw "Missing RPC_URL in $envPath"
}
if (-not $env:GARAGA_ADAPTER_ADDRESS) {
    throw "Missing GARAGA_ADAPTER_ADDRESS in $envPath"
}
if (-not $env:GARAGA_VERIFICATION_MODE) {
    $env:GARAGA_VERIFICATION_MODE = "5"
}

if (-not $UseWsl) {
    $sncastCmd = Get-Command sncast -ErrorAction SilentlyContinue
    if (-not $sncastCmd) {
        throw "sncast not found in Windows PATH. Re-run this script with -UseWsl or install sncast on Windows."
    }
}
else {
    $check = & wsl test -x $WslSncastPath; $code = $LASTEXITCODE
    if ($code -ne 0) {
        throw "WSL sncast path not executable: $WslSncastPath"
    }
    $checkScarb = & wsl test -x $WslScarbPath; $codeScarb = $LASTEXITCODE
    if ($codeScarb -ne 0) {
        throw "WSL scarb path not executable: $WslScarbPath"
    }
    $checkUsc = & wsl test -x $WslUscPath; $codeUsc = $LASTEXITCODE
    if ($codeUsc -ne 0) {
        throw "WSL universal-sierra-compiler path not executable: $WslUscPath"
    }
}

if (-not $SkipDeclare) {
    Write-Host "Declaring Groth16VerifierBLS12_381..."
    $declareOutput = Invoke-Sncast -WorkingDir $regenDir -CmdArgs @(
        "--wait",
        "--wait-timeout", $WaitTimeout.ToString(),
        "--wait-retry-interval", $WaitRetryInterval.ToString(),
        "--account", $Account,
        "declare",
        "--url", $env:RPC_URL,
        "--contract-name", "Groth16VerifierBLS12_381"
    )
    Write-Host $declareOutput
    $ClassHash = Parse-HexFromOutput -Text $declareOutput -Label "Class hash"
    if (-not $ClassHash) {
        throw "Failed to parse class hash from declare output."
    }
}
elseif (-not $ClassHash) {
    throw "SkipDeclare enabled but -ClassHash is empty."
}

Write-Host "Deploying verifier class hash: $ClassHash"
$deployOutput = Invoke-Sncast -WorkingDir $smartcontractDir -CmdArgs @(
    "--wait",
    "--wait-timeout", $WaitTimeout.ToString(),
    "--wait-retry-interval", $WaitRetryInterval.ToString(),
    "--account", $Account,
    "deploy",
    "--url", $env:RPC_URL,
    "--class-hash", $ClassHash
)
Write-Host $deployOutput

$newVerifier = Parse-HexFromOutput -Text $deployOutput -Label "Contract Address"
if (-not $newVerifier) {
    throw "Failed to parse new verifier contract address."
}

Write-Host "Updating GARAGA_VERIFIER_ADDRESS in .env -> $newVerifier"
Update-EnvFile -Path $envPath -Key "GARAGA_VERIFIER_ADDRESS" -Value $newVerifier

Write-Host "Updating Garaga adapter verifier pointer..."
Invoke-Sncast -WorkingDir $smartcontractDir -CmdArgs @(
    "--wait",
    "--wait-timeout", $WaitTimeout.ToString(),
    "--wait-retry-interval", $WaitRetryInterval.ToString(),
    "--account", $Account,
    "invoke",
    "--url", $env:RPC_URL,
    "--contract-address", $env:GARAGA_ADAPTER_ADDRESS,
    "--function", "set_verifier",
    "--calldata", $newVerifier
) | Out-Null

Write-Host "Applying GARAGA verification mode: $($env:GARAGA_VERIFICATION_MODE)"
Invoke-Sncast -WorkingDir $smartcontractDir -CmdArgs @(
    "--wait",
    "--wait-timeout", $WaitTimeout.ToString(),
    "--wait-retry-interval", $WaitRetryInterval.ToString(),
    "--account", $Account,
    "invoke",
    "--url", $env:RPC_URL,
    "--contract-address", $env:GARAGA_ADAPTER_ADDRESS,
    "--function", "set_verification_mode",
    "--calldata", $env:GARAGA_VERIFICATION_MODE
) | Out-Null

if ($env:ZK_PRIVACY_ROUTER_ADDRESS) {
    Write-Host "Ensuring privacy router points to Garaga adapter..."
    Invoke-Sncast -WorkingDir $smartcontractDir -CmdArgs @(
        "--wait",
        "--wait-timeout", $WaitTimeout.ToString(),
        "--wait-retry-interval", $WaitRetryInterval.ToString(),
        "--account", $Account,
        "invoke",
        "--url", $env:RPC_URL,
        "--contract-address", $env:ZK_PRIVACY_ROUTER_ADDRESS,
        "--function", "set_verifier",
        "--calldata", $env:GARAGA_ADAPTER_ADDRESS
    ) | Out-Null
}

Write-Host "Done."
Write-Host "GARAGA_VERIFIER_ADDRESS=$newVerifier"
