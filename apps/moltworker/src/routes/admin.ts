import { Hono } from "hono";
import type { Env } from "../index.ts";

export const adminRoutes = new Hono<{ Bindings: Env }>();

/**
 * GET /_admin
 *
 * Admin dashboard for managing ClawFooding deployments.
 * Protected by Cloudflare Access in production.
 */
adminRoutes.get("/", async (c) => {
	return c.html(`
		<!DOCTYPE html>
		<html lang="ja">
		<head>
			<meta charset="utf-8">
			<meta name="viewport" content="width=device-width, initial-scale=1">
			<title>ClawFooding Admin</title>
			<style>
				* { margin: 0; padding: 0; box-sizing: border-box; }
				body {
					font-family: 'SF Mono', 'Monaco', 'Cascadia Code', monospace;
					background: #0a0a0a; color: #e0e0e0;
					max-width: 960px; margin: 0 auto; padding: 24px;
				}
				h1 { color: #ff6b6b; margin-bottom: 8px; }
				h2 { color: #ffa07a; margin: 24px 0 12px; font-size: 1.1em; }
				.subtitle { color: #888; margin-bottom: 24px; }
				.card {
					background: #1a1a1a; border: 1px solid #333;
					border-radius: 8px; padding: 16px; margin-bottom: 16px;
				}
				.card h3 { color: #ff8a80; margin-bottom: 8px; }
				label { display: block; color: #aaa; margin: 8px 0 4px; font-size: 0.9em; }
				input, select, textarea {
					width: 100%; padding: 8px; background: #222; border: 1px solid #444;
					border-radius: 4px; color: #e0e0e0; font-family: inherit; font-size: 0.9em;
				}
				textarea { min-height: 80px; resize: vertical; }
				button {
					background: #ff6b6b; color: #fff; border: none;
					padding: 10px 20px; border-radius: 4px; cursor: pointer;
					font-family: inherit; font-weight: bold; margin-top: 12px;
				}
				button:hover { background: #ff4444; }
				button.secondary { background: #444; }
				button.secondary:hover { background: #555; }
				.persona-grid {
					display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
					gap: 8px; margin: 8px 0;
				}
				.persona-chip {
					background: #222; border: 1px solid #444; border-radius: 4px;
					padding: 8px; cursor: pointer; font-size: 0.85em;
				}
				.persona-chip.selected { border-color: #ff6b6b; background: #2a1515; }
				.persona-chip .name { font-weight: bold; color: #ffa07a; }
				.persona-chip .desc { color: #888; font-size: 0.8em; margin-top: 4px; }
				#result { margin-top: 16px; padding: 12px; background: #111; border-radius: 4px; display: none; }
				#result.visible { display: block; }
				pre { white-space: pre-wrap; word-break: break-all; font-size: 0.85em; }
				.status { display: inline-block; padding: 2px 8px; border-radius: 3px; font-size: 0.8em; }
				.status.queued { background: #444; }
				.status.running { background: #1a3a1a; color: #4caf50; }
				.status.completed { background: #1a2a3a; color: #42a5f5; }
				.status.failed { background: #3a1a1a; color: #ef5350; }
			</style>
		</head>
		<body>
			<h1>🦞 ClawFooding Admin</h1>
			<p class="subtitle">Cognitive Pattern Testing - Managed Service Dashboard</p>

			<div class="card">
				<h3>Deploy New Test</h3>
				<form id="deployForm">
					<label>Target URL (staging/dev site)</label>
					<input type="url" id="targetUrl" placeholder="https://staging.your-app.com" required>

					<label>Test Goal</label>
					<textarea id="goal" placeholder="ユーザー登録フローを完了できるか検証する。フォーム入力、バリデーション、確認画面、完了画面までのE2E。" required></textarea>

					<label>Select Personas</label>
					<div class="persona-grid" id="personaGrid"></div>

					<label>Model</label>
					<select id="model">
						<option value="anthropic/claude-sonnet-4-5">Claude Sonnet 4.5 (Recommended)</option>
						<option value="anthropic/claude-opus-4-5">Claude Opus 4.5 (Highest Quality)</option>
						<option value="anthropic/claude-haiku-4-5">Claude Haiku 4.5 (Fastest / Cheapest)</option>
					</select>

					<label>Max Session Duration (seconds)</label>
					<input type="number" id="maxDuration" value="600" min="60" max="3600">

					<button type="submit">Deploy Test Agent</button>
				</form>
			</div>

			<div id="result">
				<pre id="resultContent"></pre>
			</div>

			<h2>Recent Deployments</h2>
			<div id="deployments">
				<p style="color: #666;">Loading...</p>
			</div>

			<script>
				const personas = [
					{ id: 'haruka', name: 'Haruka (初心者)', desc: '32歳、非エンジニア、初回利用' },
					{ id: 'kenji', name: 'Kenji (急いでる人)', desc: '45歳、マネージャー、時間がない' },
					{ id: 'yuki', name: 'Yuki (パワーユーザー)', desc: '28歳、エンジニア、毎日使う' },
					{ id: 'takeshi', name: 'Takeshi (高齢者)', desc: '68歳、退職者、iPad利用' },
					{ id: 'mika', name: 'Mika (アクセシビリティ)', desc: '25歳、視覚障害、スクリーンリーダー' },
					{ id: 'chaos', name: 'Chaos (エッジケース)', desc: '予測不能な操作パターン' },
				];

				const selected = new Set(['haruka', 'kenji', 'yuki']);
				const grid = document.getElementById('personaGrid');

				personas.forEach(p => {
					const chip = document.createElement('div');
					chip.className = 'persona-chip' + (selected.has(p.id) ? ' selected' : '');
					chip.innerHTML = '<div class="name">' + p.name + '</div><div class="desc">' + p.desc + '</div>';
					chip.onclick = () => {
						if (selected.has(p.id)) { selected.delete(p.id); chip.classList.remove('selected'); }
						else { selected.add(p.id); chip.classList.add('selected'); }
					};
					grid.appendChild(chip);
				});

				document.getElementById('deployForm').onsubmit = async (e) => {
					e.preventDefault();
					const result = document.getElementById('result');
					const content = document.getElementById('resultContent');
					result.className = 'visible';
					content.textContent = 'Deploying...';

					try {
						const res = await fetch('/api/deploy', {
							method: 'POST',
							headers: { 'Content-Type': 'application/json', 'X-API-Key': prompt('Enter API Key:') },
							body: JSON.stringify({
								target_url: document.getElementById('targetUrl').value,
								goal: document.getElementById('goal').value,
								personas: Array.from(selected),
								model: document.getElementById('model').value,
								permissions: {
									max_session_duration: parseInt(document.getElementById('maxDuration').value),
								},
							}),
						});
						const data = await res.json();
						content.textContent = JSON.stringify(data, null, 2);
					} catch (err) {
						content.textContent = 'Error: ' + err.message;
					}
				};
			</script>
		</body>
		</html>
	`);
});
