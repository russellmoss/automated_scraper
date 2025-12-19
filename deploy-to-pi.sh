#!/bin/bash

# ============================================================
# Savvy Pirate - Raspberry Pi Deployment Script
# ============================================================
# Run from Git Bash, WSL, or any bash-compatible terminal on Windows
#
# Usage:
#   ./deploy-to-pi.sh              # Full deployment + restart Chromium
#   ./deploy-to-pi.sh --files-only # Just copy files, no restart
#   ./deploy-to-pi.sh --restart    # Just restart Chromium, no file copy
#   ./deploy-to-pi.sh --quick      # Copy only commonly modified files
# ============================================================

# ------------------------------
# CONFIGURATION - Edit these!
# ------------------------------

PI_USER="savvy-pirate"
PI_EXTENSION_PATH="/home/savvy-pirate/extensions"

# Connection modes - choose between local network or Tailscale VPN
PI_HOST_LOCAL="savvy-pirate.local"        # Local network (or use: 192.168.3.232)
PI_HOST_TAILSCALE="100.123.156.60"       # Tailscale VPN (or use: raspberrypi.tail925a98.ts.net)

# Default connection mode (can be overridden with --local or --tailscale flags)
# Options: "local" or "tailscale"
DEFAULT_MODE="tailscale"

# Local path to your extension (Windows path converted for Git Bash)
# For Git Bash, use: /c/Users/YourName/path/to/savvy-pirate
# For WSL, use: /mnt/c/Users/YourName/path/to/savvy-pirate
LOCAL_EXTENSION_PATH="/c/Users/russe/automated_scraper"  

# Chromium launch command on Pi (adjust if you use different flags)
CHROMIUM_CMD="chromium-browser --load-extension=${PI_EXTENSION_PATH} --no-first-run --disable-session-crashed-bubble &"

# SSH key (optional - leave empty to use password auth)
SSH_KEY=""  # e.g., "/c/Users/YourName/.ssh/id_rsa"

# ------------------------------
# Colors for output
# ------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ------------------------------
# Helper functions
# ------------------------------

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Build SSH command with optional key
get_ssh_cmd() {
    if [ -n "$SSH_KEY" ]; then
        echo "ssh -i $SSH_KEY"
    else
        echo "ssh"
    fi
}

# Build SCP command with optional key
get_scp_cmd() {
    if [ -n "$SSH_KEY" ]; then
        echo "scp -i $SSH_KEY"
    else
        echo "scp"
    fi
}

# ------------------------------
# Deployment functions
# ------------------------------

copy_all_files() {
    log_info "Copying all extension files to Pi..."
    
    local SCP_CMD=$(get_scp_cmd)
    local SSH_CMD=$(get_ssh_cmd)

    # Ensure destination exists on Pi (must be done remotely, not locally)
    log_info "Ensuring extension directory exists on Pi: ${PI_EXTENSION_PATH}"
    $SSH_CMD ${PI_USER}@${PI_HOST} "mkdir -p '${PI_EXTENSION_PATH}' '${PI_EXTENSION_PATH}/background' '${PI_EXTENSION_PATH}/content' '${PI_EXTENSION_PATH}/popup' '${PI_EXTENSION_PATH}/utils' '${PI_EXTENSION_PATH}/icons'"
    if [ $? -ne 0 ]; then
        log_error "Failed to create extension directory on Pi"
        exit 1
    fi
    
    # Copy entire extension directory (excluding .git and node_modules if present)
    $SCP_CMD -r \
        "${LOCAL_EXTENSION_PATH}/background" \
        "${LOCAL_EXTENSION_PATH}/content" \
        "${LOCAL_EXTENSION_PATH}/popup" \
        "${LOCAL_EXTENSION_PATH}/utils" \
        "${LOCAL_EXTENSION_PATH}/icons" \
        "${LOCAL_EXTENSION_PATH}/manifest.json" \
        "${PI_USER}@${PI_HOST}:${PI_EXTENSION_PATH}/"
    
    if [ $? -eq 0 ]; then
        log_success "All files copied successfully"
    else
        log_error "File copy failed"
        exit 1
    fi
}

copy_quick_files() {
    log_info "Copying commonly modified files only..."
    
    local SCP_CMD=$(get_scp_cmd)
    local SSH_CMD=$(get_ssh_cmd)

    # Ensure destination exists on Pi
    log_info "Ensuring extension directory exists on Pi: ${PI_EXTENSION_PATH}"
    $SSH_CMD ${PI_USER}@${PI_HOST} "mkdir -p '${PI_EXTENSION_PATH}/background' '${PI_EXTENSION_PATH}/content' '${PI_EXTENSION_PATH}/popup' '${PI_EXTENSION_PATH}/utils'"
    if [ $? -ne 0 ]; then
        log_error "Failed to create extension directory on Pi"
        exit 1
    fi
    
    # Copy just the files most frequently edited
    $SCP_CMD "${LOCAL_EXTENSION_PATH}/background/auth.js" "${PI_USER}@${PI_HOST}:${PI_EXTENSION_PATH}/background/"
    $SCP_CMD "${LOCAL_EXTENSION_PATH}/background/scheduler.js" "${PI_USER}@${PI_HOST}:${PI_EXTENSION_PATH}/background/"
    $SCP_CMD "${LOCAL_EXTENSION_PATH}/background/service_worker.js" "${PI_USER}@${PI_HOST}:${PI_EXTENSION_PATH}/background/"
    $SCP_CMD "${LOCAL_EXTENSION_PATH}/background/notifications.js" "${PI_USER}@${PI_HOST}:${PI_EXTENSION_PATH}/background/"
    $SCP_CMD "${LOCAL_EXTENSION_PATH}/background/sheets_api.js" "${PI_USER}@${PI_HOST}:${PI_EXTENSION_PATH}/background/"
    $SCP_CMD "${LOCAL_EXTENSION_PATH}/background/sheet_sync.js" "${PI_USER}@${PI_HOST}:${PI_EXTENSION_PATH}/background/"
    $SCP_CMD "${LOCAL_EXTENSION_PATH}/content/content.js" "${PI_USER}@${PI_HOST}:${PI_EXTENSION_PATH}/content/"
    $SCP_CMD "${LOCAL_EXTENSION_PATH}/popup/popup.js" "${PI_USER}@${PI_HOST}:${PI_EXTENSION_PATH}/popup/"
    $SCP_CMD "${LOCAL_EXTENSION_PATH}/popup/popup.html" "${PI_USER}@${PI_HOST}:${PI_EXTENSION_PATH}/popup/"
    $SCP_CMD "${LOCAL_EXTENSION_PATH}/utils/constants.js" "${PI_USER}@${PI_HOST}:${PI_EXTENSION_PATH}/utils/"
    $SCP_CMD "${LOCAL_EXTENSION_PATH}/manifest.json" "${PI_USER}@${PI_HOST}:${PI_EXTENSION_PATH}/"
    
    if [ $? -eq 0 ]; then
        log_success "Quick files copied successfully"
    else
        log_error "File copy failed"
        exit 1
    fi
}

restart_chromium() {
    log_info "Restarting Chromium on Pi..."
    
    local SSH_CMD=$(get_ssh_cmd)
    
    # Kill existing Chromium, wait, then restart
    $SSH_CMD ${PI_USER}@${PI_HOST} << EOF
        echo "Stopping Chromium..."
        pkill -f chromium || true
        sleep 2
        
        echo "Starting Chromium with extension..."
        export DISPLAY=:0
        cd ${PI_EXTENSION_PATH}
        nohup ${CHROMIUM_CMD} > /dev/null 2>&1 &
        
        sleep 3
        
        if pgrep -f chromium > /dev/null; then
            echo "Chromium started successfully"
        else
            echo "WARNING: Chromium may not have started"
        fi
EOF
    
    if [ $? -eq 0 ]; then
        log_success "Chromium restarted"
    else
        log_error "Restart command failed"
        exit 1
    fi
}

show_status() {
    log_info "Checking Pi status..."
    
    local SSH_CMD=$(get_ssh_cmd)
    
    $SSH_CMD ${PI_USER}@${PI_HOST} << EOF
        echo "=== Chromium Status ==="
        if pgrep -f chromium > /dev/null; then
            echo "Chromium is RUNNING"
            pgrep -f chromium | head -3
        else
            echo "Chromium is NOT running"
        fi
        
        echo ""
        echo "=== Extension Files ==="
        ls -la ${PI_EXTENSION_PATH}/ | head -10
        
        echo ""
        echo "=== Last Modified ==="
        find ${PI_EXTENSION_PATH} -name "*.js" -type f -printf '%T@ %p\n' | sort -rn | head -5 | cut -d' ' -f2-
EOF
}

show_usage() {
    echo "Savvy Pirate Deployment Script"
    echo ""
    echo "Usage: ./deploy-to-pi.sh [connection-mode] [option]"
    echo ""
    echo "Connection Modes:"
    echo "  --local, -l       Use local network connection (default: savvy-pirate.local)"
    echo "  --tailscale, -t   Use Tailscale VPN connection (default: 100.123.156.60)"
    echo "                    Default mode: tailscale"
    echo ""
    echo "Options:"
    echo "  (no option)    Full deployment: copy all files + restart Chromium"
    echo "  --files-only   Copy all files without restarting Chromium"
    echo "  --quick        Copy only frequently modified files + restart"
    echo "  --restart      Restart Chromium only (no file copy)"
    echo "  --status       Show Pi status (Chromium running, file list)"
    echo "  --help         Show this help message"
    echo ""
    echo "Examples:"
    echo "  ./deploy-to-pi.sh --tailscale              # Full deploy via Tailscale"
    echo "  ./deploy-to-pi.sh --local --quick          # Quick deploy via local network"
    echo "  ./deploy-to-pi.sh -t --files-only          # Copy files via Tailscale"
    echo ""
    echo "Configuration:"
    echo "  Edit the variables at the top of this script:"
    echo "  - PI_HOST_LOCAL: Your Raspberry Pi's local network address"
    echo "  - PI_HOST_TAILSCALE: Your Raspberry Pi's Tailscale address"
    echo "  - LOCAL_EXTENSION_PATH: Path to extension on your Windows machine"
}

# ------------------------------
# Connection mode selection
# ------------------------------

# Initialize connection mode
CONNECTION_MODE="${DEFAULT_MODE}"
DEPLOY_OPTION=""

# Parse all arguments
while [[ $# -gt 0 ]]; do
    case "$1" in
        --local|-l)
            CONNECTION_MODE="local"
            shift
            ;;
        --tailscale|-t)
            CONNECTION_MODE="tailscale"
            shift
            ;;
        --files-only|--quick|--restart|--status|--help)
            DEPLOY_OPTION="$1"
            shift
            ;;
        *)
            log_error "Unknown option: $1"
            show_usage
            exit 1
            ;;
    esac
done

# Set PI_HOST based on selected mode
if [ "$CONNECTION_MODE" == "local" ]; then
    PI_HOST="${PI_HOST_LOCAL}"
    CONNECTION_NAME="Local Network"
else
    PI_HOST="${PI_HOST_TAILSCALE}"
    CONNECTION_NAME="Tailscale VPN"
fi

# ------------------------------
# Main script
# ------------------------------

echo ""
echo "=========================================="
echo "  Savvy Pirate → Raspberry Pi Deployer"
echo "=========================================="
echo ""
log_info "Connection Mode: ${CONNECTION_NAME}"
log_info "Target Host: ${PI_HOST}"
echo ""

# Validate configuration
if [[ -z "$PI_HOST" ]] || [[ "$PI_HOST" == *"XXX"* ]]; then
    log_error "Please edit the script and set PI_HOST_LOCAL and PI_HOST_TAILSCALE to your Pi's addresses"
    exit 1
fi

if [[ "$LOCAL_EXTENSION_PATH" == *"YourName"* ]]; then
    log_error "Please edit the script and set LOCAL_EXTENSION_PATH to your extension folder"
    exit 1
fi

# Execute deployment based on option
case "${DEPLOY_OPTION}" in
    --files-only)
        copy_all_files
        log_success "Deployment complete (files only - remember to reload extension manually)"
        ;;
    --quick)
        copy_quick_files
        restart_chromium
        log_success "Quick deployment complete!"
        ;;
    --restart)
        restart_chromium
        log_success "Restart complete!"
        ;;
    --status)
        show_status
        ;;
    --help)
        show_usage
        ;;
    "")
        # Default: full deployment
        copy_all_files
        restart_chromium
        log_success "Full deployment complete!"
        ;;
esac

echo ""
