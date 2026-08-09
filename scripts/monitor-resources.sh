#!/usr/bin/env bash
# System resource monitoring (P4 §39) — cron job logging RAM/disk/CPU and
# alerting past a threshold. Runs on the Oracle VM host directly, not inside a
# container: Gotenberg/LibreOffice/Ghostscript share the host's actual RAM
# (docker-compose.yml's `mem_limit: 1g` on gotenberg bounds one container, not
# the box), so `free`/`df`/load average need host-level visibility, which a
# container's own cgroup view doesn't have.
#
# Thresholds match the report's own numbers: RAM > 80%, disk > 70%, CPU
# (5-minute load average vs core count) sustained > 80%.
#
# Install (once, on the VM, by hand — same posture as every other cron/manual
# step in project-docs/GO_LIVE_PLAN.md §9):
#   crontab -e
#   */5 * * * * ~/FileCast/scripts/monitor-resources.sh >> ~/monitor.log 2>&1
#
# Alerting is optional and additive: set MONITOR_WEBHOOK_URL in the invoking
# environment (e.g. via a wrapper in cron, or exported in ~/.bashrc sourced by
# a login-shell cron invocation) to also POST a JSON payload to any
# webhook-compatible endpoint (Slack incoming webhook, Discord, a relay) when
# a threshold is breached. Unset ⇒ this script only logs; nothing degrades
# gracefully, since there's nothing to fail — this is a no-op superset of the
# report's plainer "cron job logging" ask.
set -euo pipefail

RAM_THRESHOLD=80
DISK_THRESHOLD=70
CPU_THRESHOLD=80
DISK_PATH="/"

timestamp() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }

ram_pct() {
  # MemAvailable (not MemFree) accounts for reclaimable cache/buffers, the
  # same number `free`'s "available" column reports — MemFree alone
  # overstates usage on a box that's been up a while and has a healthy page
  # cache.
  awk '
    /^MemTotal:/     { total = $2 }
    /^MemAvailable:/ { avail = $2 }
    END { if (total > 0) printf "%.0f", (total - avail) / total * 100 }
  ' /proc/meminfo
}

disk_pct() {
  df -P "$DISK_PATH" | awk 'NR==2 { gsub("%", "", $5); print $5 }'
}

cpu_pct_5min() {
  # loadavg's 2nd field is the 5-minute load average; divide by core count so
  # this reads as a percentage the same way `top` does, not a raw load number
  # that means something different on a 2-core box vs a 16-core one.
  local load5 cores
  load5=$(awk '{ print $2 }' /proc/loadavg)
  cores=$(nproc)
  awk -v l="$load5" -v c="$cores" 'BEGIN { printf "%.0f", (l / c) * 100 }'
}

alert() {
  local message="$1"
  echo "[$(timestamp)] ALERT: $message"
  if [ -n "${MONITOR_WEBHOOK_URL:-}" ]; then
    curl -fsS -m 10 -X POST -H "Content-Type: application/json" \
      -d "{\"text\":\"FileCast VM: ${message}\"}" \
      "$MONITOR_WEBHOOK_URL" >/dev/null 2>&1 || \
      echo "[$(timestamp)] WARN: webhook POST failed"
  fi
}

ram=$(ram_pct)
disk=$(disk_pct)
cpu=$(cpu_pct_5min)

echo "[$(timestamp)] ram=${ram}% disk=${disk}% cpu_5min=${cpu}%"

if [ "$ram" -gt "$RAM_THRESHOLD" ]; then
  alert "RAM at ${ram}% (threshold ${RAM_THRESHOLD}%)"
fi
if [ "$disk" -gt "$DISK_THRESHOLD" ]; then
  alert "Disk at ${disk}% (threshold ${DISK_THRESHOLD}%)"
fi
if [ "$cpu" -gt "$CPU_THRESHOLD" ]; then
  alert "CPU 5-min average at ${cpu}% (threshold ${CPU_THRESHOLD}%)"
fi

exit 0
