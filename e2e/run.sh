#!/bin/bash
# MCP Station E2E: build, pack, install into an isolated DSH 0.2.1-rc.5 web
# profile, boot the web app, probe the HTTP API, and screenshot the panel.
set -u
W=/Users/wilson/.dsh/workspace
PROJ="$W/mcp-station"
export DSH_HOME="$PROJ/e2e/home"
export npm_config_cache="$W/.npm-cache"
export XDG_DATA_HOME="$W/.local-share"
export XDG_CACHE_HOME="$W/.local-cache"
export PATH="/Users/wilson/.nvm/versions/node/v22.22.3/bin:$PATH"
CLI="$W/dsh-runtime/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js"
PORT="${E2E_PORT:-49710}"
LOG="$PROJ/e2e/boot.log"
SHOTS="$PROJ/e2e/screenshots"
mkdir -p "$SHOTS" "$PROJ/e2e"

cd "$PROJ" || exit 1
echo "=== 1. build"
npm run build 2>&1 | tail -4 || exit 1
echo "=== 2. pack"
npm pack --pack-destination e2e > /tmp/mcp-station-pack.log 2>&1 || { tail -20 /tmp/mcp-station-pack.log; exit 1; }
TGZ=$(ls -t "$PROJ"/e2e/dsh-mcp-station-*.tgz 2>/dev/null | head -1)
[ -n "${TGZ:-}" ] || { echo "no tgz"; exit 1; }
echo "tgz: $TGZ"

if [ "${KEEP_HOME:-0}" != "1" ]; then
  rm -rf "$DSH_HOME"
  mkdir -p "$DSH_HOME"
fi

echo "=== 3. install into isolated profile"
node "$CLI" plugin --profile web add "$TGZ" 2>&1 | tail -8
node -e "const p=require(process.env.DSH_HOME+'/profiles/web/package.json');console.log('deps:',Object.keys(p.dependencies||{}).join(','));console.log('bundles:',(p.dsh&&p.dsh.profile&&p.dsh.profile.bundles||[]).join(','))"

echo "=== 4. boot"
node "$CLI" --profile web --patch "$PROJ/e2e/no-welcome.yml" --host 127.0.0.1 --port "$PORT" --no-open > "$LOG" 2>&1 &
BOOT_PID=$!
trap "kill $BOOT_PID 2>/dev/null" EXIT
URL=""
for i in $(seq 1 90); do
  URL=$(grep -oE "http://127\.0\.0\.1:$PORT/\?token=[A-Za-z0-9_-]+" "$LOG" | head -1)
  [ -n "$URL" ] && break
  sleep 1
done
if [ -z "$URL" ]; then
  echo "BOOT FAILED"; tail -40 "$LOG"; exit 1
fi
echo "URL: ${URL%%token=*}token=***"

echo "=== 5. API probes"
probe() {
  code=$(curl -s -o /tmp/mcp-station-body -w "%{http_code}" -m 25 "http://127.0.0.1:$PORT$1")
  echo "$1 -> $code $(head -c 260 /tmp/mcp-station-body | tr "\n" " ")"
}
probe "/mcp-station/api/status"
probe "/mcp-station/api/catalog"
probe "/mcp-station/api/servers"
probe "/mcp-station/api/doctor"

echo "=== 6. install Playwright preset through the API"
curl -s -m 30 -X POST "http://127.0.0.1:$PORT/mcp-station/api/servers/install" -H "content-type: application/json" -d "{\"presetId\":\"playwright\"}" | head -c 400; echo
sleep 3
probe "/mcp-station/api/servers"

echo "=== 6b. real test connection (npx Playwright MCP; first run downloads)"
curl -s -m 180 -X POST "http://127.0.0.1:$PORT/mcp-station/api/servers/test" -H "content-type: application/json" -d "{\"serverName\":\"playwright\"}" | head -c 700; echo
probe "/mcp-station/api/servers"
echo "=== 6c. custom server (everything) ==="
CACHE="$DSH_HOME/mcp-station/npm-cache"
node -e "const fs=require('fs');const cache=process.argv[1];fs.writeFileSync('e2e/custom.json',JSON.stringify({serverName:'station-custom',transport:'stdio',command:'npx',args:['-y','@modelcontextprotocol/server-everything'],env:{npm_config_cache:cache}}))" "$CACHE"
curl -s -m 60 -X POST "http://127.0.0.1:$PORT/mcp-station/api/servers/custom" -H "content-type: application/json" --data-binary @e2e/custom.json | head -c 450; echo
curl -s -m 120 -X POST "http://127.0.0.1:$PORT/mcp-station/api/servers/test" -H "content-type: application/json" -d "{\"serverName\":\"station-custom\"}" | head -c 450; echo
probe "/mcp-station/api/servers"

echo "=== 6d. import Claude/Cursor JSON ==="
node -e "const fs=require('fs');const cache=process.argv[1];fs.writeFileSync('e2e/import.json',JSON.stringify({json:JSON.stringify({mcpServers:{'station-memory':{command:'npx',args:['-y','@modelcontextprotocol/server-memory'],env:{npm_config_cache:cache}},'bad name!':{command:'npx'}}})}))" "$CACHE"
curl -s -m 60 -X POST "http://127.0.0.1:$PORT/mcp-station/api/servers/import" -H "content-type: application/json" --data-binary @e2e/import.json | head -c 550; echo
probe "/mcp-station/api/servers"

echo "=== 6e. install with auto test ==="
curl -s -m 120 -X POST "http://127.0.0.1:$PORT/mcp-station/api/servers/install" -H "content-type: application/json" -d "{\"presetId\":\"memory\",\"test\":true}" | head -c 550; echo
probe "/mcp-station/api/servers"
echo "=== 7. UI screenshots"
node "$PROJ/e2e/shot.cjs" "$URL" "$SHOTS" 2>&1 | tail -20

echo "=== 8. boot log errors"
grep -inE "error|failed|already registered|mcp-station" "$LOG" | head -30
echo "=== log tail"
tail -8 "$LOG"
echo "DONE"
