#!/usr/bin/env bash
# scripts/daemon-wrapper.sh
#
# True daemon launcher: completely detaches from the calling terminal so the
# stack survives shell exit, SSH disconnect, and Hermes agent turn completion.
#
# Usage:  ./daemon-wrapper.sh start
#         ./daemon-wrapper.sh stop
#         ./daemon-wrapper.sh status

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
PIDFILE="$ROOT_DIR/.clipai.pid"
LOGFILE="$ROOT_DIR/.clipai.log"

start_daemon() {
  if [[ -f "$PIDFILE" ]]; then
    local old_pid
    old_pid=$(cat "$PIDFILE" 2>/dev/null)
    if kill -0 "$old_pid" 2>/dev/null; then
      echo "❌ ClipAIv2 sudah jalan (PID $old_pid)"
      echo "   Matikan dulu dengan: npm run stop"
      exit 1
    else
      rm -f "$PIDFILE"
    fi
  fi

  echo "🚀 Meluncurkan ClipAIv2 sebagai daemon..."
  
  # True daemonization: setsid creates a new session, nohup ignores SIGHUP,
  # and the triple-fork (via node's detached:true) orphans the process so it
  # reparents to init and survives the launching shell's death.
  cd "$ROOT_DIR"
  nohup setsid node scripts/start-all.js >> "$LOGFILE" 2>&1 &
  local daemon_pid=$!
  
  # The PID we just captured is the intermediate supervisor — the actual
  # server/worker are its children. We track the supervisor.
  echo "$daemon_pid" > "$PIDFILE"
  
  sleep 2
  if kill -0 "$daemon_pid" 2>/dev/null; then
    echo "✅ ClipAIv2 daemon berjalan (PID $daemon_pid)"
    echo "   Server: http://localhost:3000"
    echo "   Log   : tail -f $LOGFILE"
  else
    echo "❌ Daemon gagal start — cek log: tail -20 $LOGFILE"
    rm -f "$PIDFILE"
    exit 1
  fi
}

stop_daemon() {
  if [[ ! -f "$PIDFILE" ]]; then
    echo "ℹ️  Tidak ada daemon yang jalan (pidfile tidak ada)"
    # Tetap bersihkan antrian dan proses nyasar.
    cd "$ROOT_DIR"
    node scripts/stop-all.js 2>/dev/null || true
    return 0
  fi

  local pid
  pid=$(cat "$PIDFILE" 2>/dev/null)
  
  if ! kill -0 "$pid" 2>/dev/null; then
    echo "ℹ️  Daemon sudah mati (PID $pid tidak ada)"
    rm -f "$PIDFILE"
    cd "$ROOT_DIR"
    node scripts/stop-all.js 2>/dev/null || true
    return 0
  fi

  echo "🛑 Menghentikan ClipAIv2 daemon (PID $pid)..."
  
  # Kirim SIGTERM ke process group — start-all.js forward ke children.
  kill -TERM -"$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
  
  # Tunggu graceful shutdown (max 8s).
  for i in {1..16}; do
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "✅ Daemon berhenti"
      rm -f "$PIDFILE"
      cd "$ROOT_DIR"
      node scripts/stop-all.js 2>/dev/null || true
      return 0
    fi
    sleep 0.5
  done
  
  # Masih hidup? SIGKILL.
  echo "⚠️  Daemon tidak merespons SIGTERM, mengirim SIGKILL..."
  kill -KILL -"$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true
  sleep 1
  rm -f "$PIDFILE"
  
  cd "$ROOT_DIR"
  node scripts/stop-all.js 2>/dev/null || true
  echo "✅ Daemon dipaksa berhenti"
}

status_daemon() {
  if [[ ! -f "$PIDFILE" ]]; then
    echo "❌ Daemon tidak jalan (pidfile tidak ada)"
    return 1
  fi

  local pid
  pid=$(cat "$PIDFILE" 2>/dev/null)
  
  if kill -0 "$pid" 2>/dev/null; then
    echo "✅ ClipAIv2 daemon jalan (PID $pid)"
    echo "   Server: http://localhost:3000"
    echo "   Log   : tail -f $LOGFILE"
    return 0
  else
    echo "❌ Daemon mati (PID $pid tidak ada, pidfile stale)"
    rm -f "$PIDFILE"
    return 1
  fi
}

case "${1:-}" in
  start)  start_daemon ;;
  stop)   stop_daemon ;;
  status) status_daemon ;;
  restart)
    stop_daemon
    sleep 2
    start_daemon
    ;;
  *)
    echo "Usage: $0 {start|stop|status|restart}"
    exit 1
    ;;
esac
