# ClawFooding マネージドサービス — MoltWorker セットアップガイド

MoltWorkerベースのClawFoodingマネージドサービスをデプロイし、
あなたの開発/ステージングサイトに対して認知パターンテストを実行する手順。

## 前提条件

- Cloudflare アカウント（Workers Paid プラン: $5/月〜）
- [Cloudflare Containers](https://developers.cloudflare.com/containers/) を有効化
- Node.js 22+ または Bun 1.3+
- Anthropic API Key（または Cloudflare AI Gateway 経由）

## 1. 初期デプロイ

```bash
cd apps/moltworker
pnpm install

# 必須シークレットの設定
npx wrangler secret put CLAWFOODING_API_KEY     # 任意のAPIキーを生成して入力
npx wrangler secret put ANTHROPIC_API_KEY        # Anthropic APIキー

# Cloudflare Access（管理画面保護）
npx wrangler secret put CF_ACCESS_TEAM_DOMAIN    # your-team.cloudflareaccess.com
npx wrangler secret put CF_ACCESS_AUD            # Access Application の Audience Tag

# デプロイ
pnpm run deploy
```

デプロイ後、`https://clawfooding-managed.<your-subdomain>.workers.dev` でアクセス可能。

## 2. ストレージの初期化

```bash
# R2 バケット作成
npx wrangler r2 bucket create clawfooding-reports
npx wrangler r2 bucket create clawfooding-billing

# D1 データベース作成
npx wrangler d1 create clawfooding-logs
# → 出力された database_id を wrangler.toml に記入

# スキーマ初期化
npx wrangler d1 execute clawfooding-logs --file=src/_schema.sql

# KV ネームスペース作成
npx wrangler kv namespace create SESSION_KV
# → 出力された id を wrangler.toml に記入
```

## 3. AI Gateway 経由の設定（推奨）

直接 Anthropic API を使う代わりに、Cloudflare AI Gateway を経由すると
レート制限・コスト監視・キャッシュが自動で有効になる。

```bash
npx wrangler secret put CLOUDFLARE_AI_GATEWAY_API_KEY
npx wrangler secret put CF_AI_GATEWAY_ACCOUNT_ID
npx wrangler secret put CF_AI_GATEWAY_GATEWAY_ID
```

## 4. ブラウザレンダリング（テスト実行に必要）

```bash
npx wrangler secret put CDP_SECRET     # openssl rand -hex 32 で生成
npx wrangler secret put WORKER_URL     # デプロイ先URL
```

## 5. あなたの開発サイトへのアクセス設定

ClawFoodingエージェントがあなたのステージング/開発サイトにアクセスするための設定。

### パターン A: パブリックステージング環境

ステージング環境がインターネットからアクセス可能な場合、追加設定不要。
テスト実行時に `target_url` として指定するだけ。

```bash
curl -X POST https://your-clawfooding.workers.dev/api/deploy \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_API_KEY" \
  -d '{
    "target_url": "https://staging.your-app.com",
    "goal": "ユーザー登録フローの完了確認",
    "personas": ["haruka", "kenji", "yuki"]
  }'
```

### パターン B: Cloudflare Tunnel 経由（プライベート環境）

開発サーバーがローカルネットワーク内にある場合、
Cloudflare Tunnel（旧 Argo Tunnel）でセキュアに公開する。

```bash
# 1. cloudflared をインストール
brew install cloudflared   # macOS
# または https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/

# 2. 認証
cloudflared tunnel login

# 3. トンネル作成
cloudflared tunnel create clawfooding-dev

# 4. 設定ファイル作成
cat > ~/.cloudflared/config.yml << 'EOF'
tunnel: <TUNNEL_ID>
credentials-file: /path/to/credentials.json

ingress:
  - hostname: dev-test.your-domain.com
    service: http://localhost:3000    # あなたの開発サーバー
  - service: http_status:404
EOF

# 5. DNS レコード追加
cloudflared tunnel route dns clawfooding-dev dev-test.your-domain.com

# 6. トンネル起動
cloudflared tunnel run clawfooding-dev
```

これで `https://dev-test.your-domain.com` からClawFoodingエージェントがアクセス可能。

### パターン C: Cloudflare Access で認証付き公開

ステージング環境を Cloudflare Access で保護しつつ、
ClawFoodingエージェントにはサービストークンでアクセスを許可する。

```bash
# 1. Cloudflare Access でステージング環境を保護
#    Dashboard → Zero Trust → Access → Applications → Add Application

# 2. Service Token を発行
#    Dashboard → Zero Trust → Access → Service Auth → Create Service Token
#    → Client ID と Client Secret をメモ

# 3. ClawFooding のテスト実行時に認証ヘッダーを指定
curl -X POST https://your-clawfooding.workers.dev/api/deploy \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_API_KEY" \
  -d '{
    "target_url": "https://staging.your-app.com",
    "goal": "ダッシュボードの全機能テスト",
    "personas": ["haruka", "kenji", "yuki", "takeshi"],
    "auth": {
      "method": "bypass_token",
      "credentials": {
        "CF-Access-Client-Id": "<CLIENT_ID>",
        "CF-Access-Client-Secret": "<CLIENT_SECRET>"
      }
    }
  }'
```

### パターン D: IP アドレスホワイトリスト

Cloudflare Workers の egress IP を開発サーバーのファイアウォールで許可する。

> **注意**: Cloudflare Workers の IP は固定されないため、この方法は推奨しない。
> パターン B (Tunnel) または C (Access) を推奨。

## 6. テスト実行（Admin UI）

1. `https://your-clawfooding.workers.dev/_admin` にアクセス
2. Cloudflare Access で認証
3. ダッシュボードから:
   - **Target URL**: テスト対象のURL入力
   - **Test Goal**: テストの目的を日本語で記述
   - **Personas**: テストに使うペルソナを選択
   - **Model**: LLMモデルを選択
4. 「Deploy Test Agent」をクリック

## 7. テスト実行（API）

```bash
# テスト開始
DEPLOY_ID=$(curl -s -X POST https://your-clawfooding.workers.dev/api/deploy \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_API_KEY" \
  -d '{
    "target_url": "https://staging.your-app.com",
    "goal": "ユーザー登録フロー完了確認",
    "personas": ["haruka", "kenji"],
    "model": "anthropic/claude-sonnet-4-5"
  }' | jq -r '.deployment_id')

echo "Deployment ID: $DEPLOY_ID"

# ステータス確認
curl -s https://your-clawfooding.workers.dev/api/deploy/$DEPLOY_ID/status \
  -H "X-API-Key: YOUR_API_KEY" | jq

# ペルソナ別課金レポート
curl -s https://your-clawfooding.workers.dev/api/deploy/$DEPLOY_ID/billing \
  -H "X-API-Key: YOUR_API_KEY" | jq

# テストレポート取得
curl -s https://your-clawfooding.workers.dev/api/deploy/$DEPLOY_ID/report \
  -H "X-API-Key: YOUR_API_KEY" | jq
```

## 8. ペルソナ別課金の確認

ClawFoodingはペルソナごとの課金率をトレースする。
各ペルソナはLLMの呼び出し回数・トークン消費量が異なるため、コストが変動する。

```bash
# 全期間のペルソナ別課金
curl -s https://your-clawfooding.workers.dev/api/billing \
  -H "X-API-Key: YOUR_API_KEY" \
  -d '{"group_by": "persona"}' | jq

# 特定ペルソナでフィルタ
curl -s "https://your-clawfooding.workers.dev/api/billing?persona=haruka" \
  -H "X-API-Key: YOUR_API_KEY" | jq
```

**課金率が高くなる傾向のペルソナ:**

| ペルソナ | 傾向 | 理由 |
|---------|------|------|
| Haruka (初心者) | 高 | retreat型回復→再試行→追加LLM呼び出し |
| Takeshi (高齢者) | 中〜高 | 線形読み→全要素スキャン→入力トークン増 |
| Chaos (エッジケース) | 最高 | 探索的操作→多数のステップ→回復コスト大 |
| Kenji (急いでる人) | 低 | 高速判断→少ないステップ→効率的 |
| Yuki (パワーユーザー) | 低 | 習慣的操作→予測可能→キャッシュ効率高 |

## 9. セキュリティチェックリスト

デプロイ前に確認すべき事項:

- [ ] `CLAWFOODING_API_KEY` は十分に長いランダム文字列か（32文字以上推奨）
- [ ] Cloudflare Access が `/_admin` を保護しているか
- [ ] テスト対象は **ステージング環境** か（本番環境での実行は非推奨）
- [ ] テスト用アカウントは **最小権限** で作成されているか
- [ ] `url_denylist` に `/admin/**`, `/billing/**` が含まれているか
- [ ] テスト後のデータクリーンアップ手順が準備されているか
- [ ] R2 バケットのアクセス権限が適切か

## 10. コスト見積もり

| リソース | 月額概算 |
|---------|---------|
| Workers Paid プラン | $5 |
| Sandbox Container (24/7) | ~$34.50 |
| Sandbox Container (sleep 10m) | ~$10-11 |
| R2 ストレージ (10GB) | $0.15 |
| D1 データベース | $0（無料枠内） |
| Browser Rendering | 従量課金 |
| **合計（最小構成）** | **~$16** |

※ LLM API コストは別途。ペルソナ別課金レポートで確認可能。

## トラブルシューティング

### エージェントがサイトにアクセスできない

1. `target_url` が正しいか確認
2. Cloudflare Tunnel が起動しているか確認 (`cloudflared tunnel info`)
3. ファイアウォールがブロックしていないか確認
4. `permissions.url_allowlist` にURLパターンが含まれているか確認

### コンテナの起動が遅い

Sandbox Container のコールドスタートは1-2分かかる場合がある。
`SANDBOX_SLEEP_AFTER=never` に設定すると常時起動で即応答だが、コストが上がる。

### テストがタイムアウトする

`max_session_duration` を増やすか、テストステップ数を減らす。
デフォルトは600秒（10分）。
