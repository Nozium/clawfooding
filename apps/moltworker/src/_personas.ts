/**
 * Embedded preset personas for the MoltWorker managed service.
 * These are the same personas as the YAML files in personas/ but
 * inlined for Cloudflare Workers which cannot read the filesystem.
 */
import type { Persona } from "@clawfooding/core/types";

export const PRESET_PERSONAS: Record<string, Persona> = {
	haruka: {
		name: "Haruka (初心者)",
		description: "32歳、非エンジニア、初回利用。探索的ナビゲーション、低リスク耐性、retreat型エラー回復。オンボーディング不備、専門用語の壁、導線の断絶を検出。",
		demographics: { age: 32, tech_level: "novice", device: "iPhone 15 Pro (390x844)", language: "ja", accessibility: "none" },
		cognitive_profile: { navigation_strategy: "exploratory", information_processing: "serial", risk_tolerance: "low", error_recovery: "retreat", reading_pattern: "f_pattern", working_memory_load: 3, attention_span: "short", decision_speed: "slow" },
		motor_profile: { pointer_precision: "low", click_speed_ms: 400, scroll_behavior: "gradual", tap_accuracy_offset_px: 8 },
		context: { motivation: "task_completion", time_pressure: "high", familiarity: "first_visit", emotional_state: "neutral", environment: "mobile_commute" },
	},
	kenji: {
		name: "Kenji (急いでる人)",
		description: "45歳、マネージャー、時間がない。目標指向、高速判断、スキャニング。重要CTAの視認性、ステップ数過多、不要な確認ダイアログを検出。",
		demographics: { age: 45, tech_level: "intermediate", device: "MacBook Pro 14 (1512x982)", language: "ja", accessibility: "none" },
		cognitive_profile: { navigation_strategy: "goal-directed", information_processing: "parallel", risk_tolerance: "high", error_recovery: "retry", reading_pattern: "scanning", working_memory_load: 5, attention_span: "short", decision_speed: "fast" },
		motor_profile: { pointer_precision: "medium", click_speed_ms: 200, scroll_behavior: "aggressive", tap_accuracy_offset_px: 3 },
		context: { motivation: "task_completion", time_pressure: "high", familiarity: "returning", emotional_state: "anxious", environment: "desktop_office" },
	},
	yuki: {
		name: "Yuki (パワーユーザー)",
		description: "28歳、エンジニア、毎日使う。習慣的ナビゲーション、並列処理、高リスク耐性。ショートカット不在、一括操作の不備、上級者向け効率化パスの欠如を検出。",
		demographics: { age: 28, tech_level: "expert", device: "Desktop (2560x1440)", language: "ja", accessibility: "none" },
		cognitive_profile: { navigation_strategy: "habitual", information_processing: "parallel", risk_tolerance: "high", error_recovery: "explore_alternative", reading_pattern: "scanning", working_memory_load: 7, attention_span: "long", decision_speed: "fast" },
		motor_profile: { pointer_precision: "high", click_speed_ms: 150, scroll_behavior: "aggressive", tap_accuracy_offset_px: 2 },
		context: { motivation: "exploration", time_pressure: "none", familiarity: "daily_user", emotional_state: "calm", environment: "desktop_office" },
	},
	takeshi: {
		name: "Takeshi (高齢者)",
		description: "68歳、退職者、iPad利用。逐次的、慎重、線形読み。フォントサイズ不足、タッチターゲット小、コントラスト不足を検出。",
		demographics: { age: 68, tech_level: "novice", device: "iPad 10th gen (820x1180)", language: "ja", accessibility: "low_vision" },
		cognitive_profile: { navigation_strategy: "exploratory", information_processing: "serial", risk_tolerance: "low", error_recovery: "retreat", reading_pattern: "linear", working_memory_load: 4, attention_span: "long", decision_speed: "slow" },
		motor_profile: { pointer_precision: "low", click_speed_ms: 600, scroll_behavior: "gradual", tap_accuracy_offset_px: 12 },
		context: { motivation: "task_completion", time_pressure: "none", familiarity: "first_visit", emotional_state: "calm", environment: "tablet_couch" },
	},
	mika: {
		name: "Mika (アクセシビリティ)",
		description: "25歳、視覚障害、スクリーンリーダー使用。聴覚的情報処理、キーボードナビゲーション。aria-label不備、Tab順序の崩れ、画像alt欠損を検出。",
		demographics: { age: 25, tech_level: "advanced", device: "MacBook Air M3 (1470x956)", language: "ja", accessibility: "screen_reader" },
		cognitive_profile: { navigation_strategy: "habitual", information_processing: "serial", risk_tolerance: "medium", error_recovery: "explore_alternative", reading_pattern: "linear", working_memory_load: 6, attention_span: "medium", decision_speed: "medium" },
		motor_profile: { pointer_precision: "high", click_speed_ms: 100, scroll_behavior: "minimal", tap_accuracy_offset_px: 0 },
		context: { motivation: "task_completion", time_pressure: "low", familiarity: "returning", emotional_state: "neutral", environment: "desktop_office" },
	},
	chaos: {
		name: "Chaos (エッジケース探索)",
		description: "パラメータをランダムに揺らす予測不能なペルソナ。想定外の入力、race condition、UIの壊れ方を検出。",
		demographics: { age: 30, tech_level: "intermediate", device: "Random (320x568 - 2560x1440)", language: "ja", accessibility: "none" },
		cognitive_profile: { navigation_strategy: "exploratory", information_processing: "parallel", risk_tolerance: "high", error_recovery: "explore_alternative", reading_pattern: "scanning", working_memory_load: 9, attention_span: "short", decision_speed: "fast" },
		motor_profile: { pointer_precision: "medium", click_speed_ms: 100, scroll_behavior: "aggressive", tap_accuracy_offset_px: 15 },
		context: { motivation: "exploration", time_pressure: "none", familiarity: "first_visit", emotional_state: "neutral", environment: "desktop_office" },
	},
};
