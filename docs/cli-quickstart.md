# ClawFooding CLI クイックスタート

## インストール

### Nix (推奨)

```bash
git clone https://github.com/Nozium/clawfooding
cd clawfooding
nix develop   # Bun, pnpm, jq, git が自動セットアップ
pnpm install
pnpm run build
```

### Bun

```bash
git clone https://github.com/Nozium/clawfooding
cd clawfooding
pnpm install
pnpm run build
```

## CLI コマンド

### ペルソナ一覧

```bash
clawfooding personas --list
```

```
── Available Personas ──

ID            Name                            Description
haruka        Haruka (初心者)                   32歳、非エンジニア、初回利用...
kenji         Kenji (急いでる人)                 45歳、マネージャー、時間がない...
yuki          Yuki (パワーユーザー)               28歳、エンジニア、毎日使う...
takeshi       Takeshi (高齢者)                  68歳、退職者、iPad利用...
mika          Mika (アクセシビリティ)              25歳、視覚障害、スクリーンリーダー...
chaos         Chaos (エッジケース)               予測不能な操作パターン...
```

### ペルソナ詳細（認知パラメータ確認）

```bash
clawfooding personas --inspect haruka
```

Fitts' Law、Hick's Law、ミスクリック確率、フォームエラー確率、
離脱確率が自動計算されて表示される。

### テスト実行

```bash
clawfooding run \
  --scenario examples/scenario-basic.yaml \
  --model anthropic/claude-sonnet-4-5
```

特定ペルソナだけでテスト:

```bash
clawfooding run \
  --scenario examples/scenario-basic.yaml \
  --persona haruka \
  --dry-run
```

### ペルソナ別課金レポート

```bash
clawfooding billing --dir .clawfooding/billing --group-by persona
```

```
── Billing by Persona ──

Persona                    Requests   Input       Output      Total Cost  Avg/Step  Share
Haruka (初心者)                   6   14,523       2,107       $0.054    $0.009   42.3%
Kenji (急いでる人)                 6   12,891       1,834       $0.043    $0.007   33.7%
Yuki (パワーユーザー)               6   11,245       1,612       $0.031    $0.005   24.0%
──────────────────────────────────────────────────────────────────────────────────────────
TOTAL                            18                            $0.128              100%
```

モデル別集計:

```bash
clawfooding billing --group-by model
```

JSON出力（パイプラインに統合可能）:

```bash
clawfooding billing --json | jq '.costPerPersonaComparison'
```

### ClawBench マルチモデルベンチマーク

```bash
clawfooding bench \
  --scenario examples/scenario-basic.yaml \
  --models "anthropic/claude-opus-4-5,anthropic/claude-sonnet-4-5,anthropic/claude-haiku-4-5" \
  --persona haruka
```

```
── ClawBench Results ──

Model                             Score   Compl%  Accur%  Recov%  Halluc%   Cost
anthropic/claude-opus-4-5          93.2      98      95      90       5   $0.312
anthropic/claude-sonnet-4-5        88.7      93      88      80      12   $0.054
anthropic/claude-haiku-4-5         79.5      82      75      60      25   $0.008

Cost-Performance Ratio (Score / $):
  anthropic/claude-haiku-4-5          9938 pts/$
  anthropic/claude-sonnet-4-5         1642 pts/$
  anthropic/claude-opus-4-5            299 pts/$
```

## シナリオファイルの書き方

```yaml
name: "Registration Flow Test"
target_url: "https://staging.your-app.com"

personas:
  - haruka
  - kenji

permissions:
  navigation: allow
  click: allow
  type: allow
  submit: allow
  delete: deny
  download: deny
  external_navigation: deny
  max_requests_per_minute: 30
  max_session_duration: 600
  url_allowlist:
    - "https://staging.your-app.com/**"
  url_denylist:
    - "*/admin/**"

steps:
  - action: navigate
    description: "Go to registration page"
  - action: type
    description: "Fill in registration form"
  - action: submit
    description: "Submit registration"
  - action: scan
    description: "Verify confirmation page"
```

## カスタムペルソナの作成

`personas/` ディレクトリにYAMLファイルを追加:

```yaml
name: "Custom Persona"
description: "Your custom test persona"

demographics:
  age: 40
  tech_level: intermediate
  device: "iPhone 16 (402x874)"
  language: ja
  accessibility: none

cognitive_profile:
  navigation_strategy: goal-directed
  information_processing: serial
  risk_tolerance: medium
  error_recovery: retry
  reading_pattern: f_pattern
  working_memory_load: 5
  attention_span: medium
  decision_speed: medium

motor_profile:
  pointer_precision: medium
  click_speed_ms: 300
  scroll_behavior: gradual
  tap_accuracy_offset_px: 5

context:
  motivation: task_completion
  time_pressure: medium
  familiarity: returning
  emotional_state: neutral
  environment: mobile_commute
```

## CI/CD 統合

```yaml
# .github/workflows/clawfooding.yml
name: ClawFooding Cognitive Tests
on:
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: pnpm install && pnpm run build
      - run: |
          clawfooding run \
            --scenario tests/scenario.yaml \
            --model anthropic/claude-haiku-4-5 \
            --json > report.json
      - run: |
          clawfooding billing --json | jq '.totalCostUSD'
```
