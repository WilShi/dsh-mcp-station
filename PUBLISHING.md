# PUBLISHING

MCP Station 的发布流程（沿用本机 DSH 插件发布 runbook）。

## 0. 版本与元数据

- 包名：dsh-mcp-station（npm 上目前空闲）
- 版本：package.json version；改完必须重新 build + pack
- 发布账号：npm wilshi；新包名走 staged publishing，需要维护者浏览器 2FA 批准

## 1. 构建与验证

    cd /Users/wilson/.dsh/workspace/mcp-station
    npm run typecheck
    npm test
    npm run build
    npm pack --pack-destination ../artifacts

核对 tgz 内容：

    tar tzf ../artifacts/dsh-mcp-station-<version>.tgz | sort

必须包含：lib/index.js、lib/client.js、lib/types/**、data/catalog.json、cordis.patch.yml、README.md、README.zh.md、MARKET.md、LICENSE。

## 2. 暂存（staged publish）

    W=/Users/wilson/.dsh/workspace
    export npm_config_cache=$W/.npm-cache
    cd $W/npm12
    ./node_modules/.bin/npm stage publish $W/artifacts/dsh-mcp-station-<version>.tgz
    ./node_modules/.bin/npm stage list

注意：直接 npm publish 新包名会变相进 stage 并报 409；统一用 stage publish。

## 3. 2FA 批准

非 TTY 下 npm 会把 authUrl 打码，按 runbook 用 --json 拿真实链接：

    ./node_modules/.bin/npm stage approve <id> --json > /tmp/wa.json 2>/dev/null || true
    node -e "const d=require('/tmp/wa.json');console.log(d.error.authUrl);console.log(d.error.doneUrl)"

浏览器完成 2FA 后轮询 doneUrl（202 继续等，200 返回一次性 OTP），然后：

    ./node_modules/.bin/npm stage approve <id> --otp <token>

也可以用 $W/npm-approve-batch.sh（把 id 填进去）。

## 4. 发布后核对

    npm view dsh-mcp-station version dist-tags.latest
    bash $W/verify-published.sh   # 若脚本已适配本包

## 5. 市场收录

- GitHub 建仓库 WilShi/dsh-mcp-station，push 源码并打 tag。
- Release 上传 dsh-mcp-station-<version>.tgz（市场可直装）。
- 提交到 awesome-dsh-plugin 收录（按仓库 README 的提交方式），分类 Browser / Tools & Capabilities。
- 市场文案见 MARKET.md；截图放 docs/screenshots。
