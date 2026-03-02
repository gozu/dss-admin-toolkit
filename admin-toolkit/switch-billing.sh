#!/bin/bash

# Script to switch Claude Code billing method
# Usage: ./switch-billing --to-subscription
#        ./switch-billing --to-api

set -e

CLAUDE_DIR="/data/home/claude/.claude"
SETTINGS_FILE="$CLAUDE_DIR/settings.json"
BACKUP_DIR="$CLAUDE_DIR/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# Parse arguments
if [ $# -eq 0 ]; then
    echo "Usage: $0 [--to-subscription|--to-api]"
    echo ""
    echo "Options:"
    echo "  --to-subscription    Switch from API billing to subscription"
    echo "  --to-api            Switch from subscription to API billing"
    exit 1
fi

MODE=""
case "$1" in
    --to-subscription)
        MODE="subscription"
        ;;
    --to-api)
        MODE="api"
        ;;
    *)
        echo "Error: Unknown option '$1'"
        echo "Usage: $0 [--to-subscription|--to-api]"
        exit 1
        ;;
esac

# Create backup directory if it doesn't exist
mkdir -p "$BACKUP_DIR"

if [ "$MODE" = "subscription" ]; then
    echo "======================================"
    echo "Switch to Subscription Billing"
    echo "======================================"
    echo ""

    # Backup current settings
    echo "[1/4] Backing up current settings..."
    cp "$SETTINGS_FILE" "$BACKUP_DIR/settings.json.$TIMESTAMP"
    echo "  ✓ Backup saved to: $BACKUP_DIR/settings.json.$TIMESTAMP"

    # Backup API key script if it exists
    if [ -f "$CLAUDE_DIR/anthropic_key.sh" ]; then
        cp "$CLAUDE_DIR/anthropic_key.sh" "$BACKUP_DIR/anthropic_key.sh.$TIMESTAMP"
        echo "  ✓ API key script backed up"
    fi

    # Remove apiKeyHelper from settings.json
    echo ""
    echo "[2/4] Updating settings.json..."
    python3 -c "
import json

settings_file = '$SETTINGS_FILE'

with open(settings_file, 'r') as f:
    settings = json.load(f)

# Remove API key configuration
if 'apiKeyHelper' in settings:
    del settings['apiKeyHelper']
    print('  ✓ Removed apiKeyHelper')
else:
    print('  ℹ apiKeyHelper not found (already removed)')

# Write updated settings
with open(settings_file, 'w') as f:
    json.dump(settings, f, indent=2)

print('  ✓ Settings updated')
"

    # Optional: Rename API key file to prevent accidental use
    echo ""
    echo "[3/4] Securing old API key file..."
    if [ -f "$CLAUDE_DIR/anthropic_key.sh" ]; then
        mv "$CLAUDE_DIR/anthropic_key.sh" "$CLAUDE_DIR/anthropic_key.sh.disabled"
        echo "  ✓ Renamed anthropic_key.sh to anthropic_key.sh.disabled"
    else
        echo "  ℹ API key file not found"
    fi

    echo ""
    echo "[4/4] Configuration complete!"
    echo ""
    echo "======================================"
    echo "Next Steps:"
    echo "======================================"
    echo ""
    echo "1. Close any running Claude Code sessions"
    echo ""
    echo "2. Run: claude login"
    echo "   (This will authenticate with your Claude.ai subscription)"
    echo ""
    echo "3. Start using Claude Code with subscription billing!"
    echo ""
    echo "======================================"
    echo "Rollback:"
    echo "======================================"
    echo ""
    echo "To switch back: $0 --to-api"
    echo ""

elif [ "$MODE" = "api" ]; then
    echo "======================================"
    echo "Switch to API Billing"
    echo "======================================"
    echo ""

    # Backup current settings
    echo "[1/4] Backing up current settings..."
    cp "$SETTINGS_FILE" "$BACKUP_DIR/settings.json.$TIMESTAMP"
    echo "  ✓ Backup saved to: $BACKUP_DIR/settings.json.$TIMESTAMP"

    # Backup credentials if they exist
    if [ -f "$CLAUDE_DIR/.credentials.json" ]; then
        cp "$CLAUDE_DIR/.credentials.json" "$BACKUP_DIR/.credentials.json.$TIMESTAMP"
        echo "  ✓ Subscription credentials backed up"
    fi

    # Check if API key file exists
    echo ""
    echo "[2/4] Checking for API key configuration..."
    if [ -f "$CLAUDE_DIR/anthropic_key.sh.disabled" ]; then
        echo "  ✓ Found disabled API key file"
        mv "$CLAUDE_DIR/anthropic_key.sh.disabled" "$CLAUDE_DIR/anthropic_key.sh"
        echo "  ✓ Re-enabled anthropic_key.sh"
    elif [ -f "$CLAUDE_DIR/anthropic_key.sh" ]; then
        echo "  ✓ API key file already active"
    else
        echo "  ⚠ Warning: No API key file found!"
        echo "  You'll need to create ~/.claude/anthropic_key.sh with your API key"
        echo ""
        echo "  Example content:"
        echo '  #!/bin/bash'
        echo '  echo "YOUR_API_KEY_HERE"'
        echo ""
        read -p "Continue anyway? (y/n) " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            echo "Aborted."
            exit 1
        fi
    fi

    # Add apiKeyHelper to settings.json
    echo ""
    echo "[3/4] Updating settings.json..."
    python3 -c "
import json

settings_file = '$SETTINGS_FILE'

with open(settings_file, 'r') as f:
    settings = json.load(f)

# Add API key configuration
settings['apiKeyHelper'] = '~/.claude/anthropic_key.sh'
print('  ✓ Added apiKeyHelper configuration')

# Write updated settings
with open(settings_file, 'w') as f:
    json.dump(settings, f, indent=2)

print('  ✓ Settings updated')
"

    echo ""
    echo "[4/4] Configuration complete!"
    echo ""
    echo "======================================"
    echo "Next Steps:"
    echo "======================================"
    echo ""
    echo "1. Close any running Claude Code sessions"
    echo ""
    echo "2. (Optional) Run: claude logout"
    echo "   (This will clear your Claude.ai subscription credentials)"
    echo ""
    echo "3. Verify your API key is set correctly:"
    echo "   bash $CLAUDE_DIR/anthropic_key.sh"
    echo "   (Should output your API key)"
    echo ""
    echo "4. Start using Claude Code with API billing!"
    echo ""
    echo "======================================"
    echo "Rollback:"
    echo "======================================"
    echo ""
    echo "To switch back: $0 --to-subscription"
    echo ""
fi

echo "All backups stored in: $BACKUP_DIR"
echo "======================================"
