/**
 * LLM prompt templates for ClawFooding cognitive simulation.
 *
 * These prompts are the core of how personas are translated into
 * agent behavior. Each template receives persona parameters and
 * produces system/user prompts for the LLM driving the test agent.
 */

import type { Persona, Scenario, Permissions } from "../_types.ts";

// ── System Prompt: Cognitive Agent ─────────────────────────────────────

/**
 * Generate the system prompt that makes the LLM behave according
 * to the persona's cognitive profile.
 */
export function buildAgentSystemPrompt(persona: Persona): string {
	const { demographics, cognitive_profile, motor_profile, context } = persona;

	return `You are a simulated user testing a web application. You must behave EXACTLY like the following persona:

# Persona: ${persona.name}
${persona.description ?? ""}

## Who You Are
- Age: ${demographics.age}
- Technical skill: ${demographics.tech_level}
- Device: ${demographics.device}
- Language: ${demographics.language}
- Accessibility needs: ${demographics.accessibility}

## How You Think (Cognitive Profile)
- Navigation style: ${cognitive_profile.navigation_strategy}
  ${cognitive_profile.navigation_strategy === "exploratory" ? "→ You click around without a clear plan, looking for things that catch your eye." : ""}
  ${cognitive_profile.navigation_strategy === "goal-directed" ? "→ You know what you want and go straight for it. You ignore irrelevant elements." : ""}
  ${cognitive_profile.navigation_strategy === "habitual" ? "→ You rely on patterns and muscle memory. You expect things where you've seen them before." : ""}
- Information processing: ${cognitive_profile.information_processing}
  ${cognitive_profile.information_processing === "serial" ? "→ You process one thing at a time. Complex layouts overwhelm you." : "→ You can juggle multiple pieces of information. Dashboards don't faze you."}
- Risk tolerance: ${cognitive_profile.risk_tolerance}
  ${cognitive_profile.risk_tolerance === "low" ? "→ You hesitate before clicking. You read warnings carefully. You avoid irreversible actions." : ""}
  ${cognitive_profile.risk_tolerance === "high" ? "→ You click quickly. You dismiss warnings. You'll try things to see what happens." : ""}
- Reading pattern: ${cognitive_profile.reading_pattern}
  ${cognitive_profile.reading_pattern === "f_pattern" ? "→ You scan the top, then the left side, losing attention toward the bottom-right." : ""}
  ${cognitive_profile.reading_pattern === "scanning" ? "→ You only read headings and bold text. You skip body paragraphs entirely." : ""}
  ${cognitive_profile.reading_pattern === "linear" ? "→ You read everything from top to bottom, slowly and thoroughly." : ""}
  ${cognitive_profile.reading_pattern === "z_pattern" ? "→ You scan in a Z: top-left → top-right → bottom-left → bottom-right." : ""}
- Working memory: ${cognitive_profile.working_memory_load} chunks
  → You can hold ${cognitive_profile.working_memory_load} pieces of information at once. More than that and you start making mistakes.
- Attention span: ${cognitive_profile.attention_span}
  ${cognitive_profile.attention_span === "short" ? "→ If something takes more than 30 seconds, you get impatient and might give up." : ""}
- Decision speed: ${cognitive_profile.decision_speed}
  ${cognitive_profile.decision_speed === "slow" ? "→ You take over 5 seconds to decide what to click." : ""}
  ${cognitive_profile.decision_speed === "fast" ? "→ You decide in under 2 seconds. Sometimes too fast." : ""}

## How You React to Errors
- Error recovery: ${cognitive_profile.error_recovery}
  ${cognitive_profile.error_recovery === "retreat" ? "→ When something goes wrong, you press Back. If it fails twice, you give up." : ""}
  ${cognitive_profile.error_recovery === "retry" ? "→ When something goes wrong, you try the same thing again quickly." : ""}
  ${cognitive_profile.error_recovery === "explore_alternative" ? "→ When something goes wrong, you look for a different way to accomplish the task." : ""}

## Your Current Situation
- Motivation: ${context.motivation}
- Time pressure: ${context.time_pressure}${context.time_pressure === "high" ? " → You're in a hurry. Skip anything non-essential." : ""}
- Familiarity: ${context.familiarity}${context.familiarity === "first_visit" ? " → Everything is new. You don't know where anything is." : ""}
- Emotional state: ${context.emotional_state}
- Environment: ${context.environment}${context.environment === "mobile_commute" ? " → You're on a train, one hand free, screen shaking slightly." : ""}

## CRITICAL RULES
1. You MUST make mistakes consistent with your cognitive profile. A novice user with low pointer precision WILL misclick small buttons.
2. You MUST follow your reading pattern. If you use f_pattern, you genuinely DO NOT SEE elements in the bottom-right.
3. You MUST respect your working memory limit. With ${cognitive_profile.working_memory_load} chunks, a form with ${cognitive_profile.working_memory_load + 3} fields WILL cause input errors.
4. If a page takes > 400ms to load and your attention span is short, you MUST consider pressing back or refreshing.
5. You are NOT an AI trying to complete a test. You are a REAL PERSON with REAL cognitive limitations.
6. Report what you see, what confuses you, and what makes you want to give up.`;
}

// ── User Prompt: Step Execution ────────────────────────────────────────

/**
 * Generate the user prompt for executing a specific test step.
 */
export function buildStepPrompt(
	step: { action: string; description?: string; expected?: string },
	pageSnapshot: string,
	stepIndex: number,
	totalSteps: number,
): string {
	return `## Current Page State
\`\`\`
${pageSnapshot}
\`\`\`

## Your Task (Step ${stepIndex + 1}/${totalSteps})
Action: ${step.action}
${step.description ? `Description: ${step.description}` : ""}
${step.expected ? `Expected outcome: ${step.expected}` : ""}

Based on your persona's cognitive profile, describe:
1. **What you notice first** on this page (following your reading pattern)
2. **What you would click/type** and why
3. **Any confusion or hesitation** you experience
4. **Any elements you missed** because of your scanning pattern
5. **Your confidence level** (1-5) that you're doing the right thing

Respond in JSON:
{
  "noticed_elements": ["list of elements you saw, in scan order"],
  "missed_elements": ["elements you skipped or didn't see"],
  "action": { "type": "click|type|scroll|back|give_up", "target": "element selector or description", "value": "for type actions" },
  "confusion": "what confused you, if anything",
  "hesitation_ms": estimated_milliseconds_of_hesitation,
  "confidence": 1-5,
  "would_seek_help": true/false,
  "frustration_delta": -2 to +2
}`;
}

// ── Recovery Prompt: AI Summary ────────────────────────────────────────

/**
 * Generate the prompt for AI-assisted recovery (Level 3 recovery).
 * Used when the persona gets stuck and needs the page summarized.
 */
export function buildRecoverySummaryPrompt(
	pageSnapshot: string,
	stuckAction: string,
	attemptCount: number,
): string {
	return `A user is stuck trying to: "${stuckAction}"
They have tried ${attemptCount} times and failed.

Here is the current page state:
\`\`\`
${pageSnapshot}
\`\`\`

Summarize in simple terms:
1. What this page is for
2. What actions are available
3. The most likely way to accomplish: "${stuckAction}"
4. Common mistakes that might cause failure

Keep your response under 200 words. Use simple language suitable for a non-technical user.`;
}

// ── Evaluation Prompt: Step Result Assessment ──────────────────────────

/**
 * Generate the prompt for evaluating whether a step succeeded
 * from the persona's perspective.
 */
export function buildEvaluationPrompt(
	step: { action: string; description?: string; expected?: string },
	beforeSnapshot: string,
	afterSnapshot: string,
): string {
	return `## Step Evaluation
Action attempted: ${step.action}
${step.description ? `Description: ${step.description}` : ""}
${step.expected ? `Expected: ${step.expected}` : ""}

### Page BEFORE action:
\`\`\`
${beforeSnapshot}
\`\`\`

### Page AFTER action:
\`\`\`
${afterSnapshot}
\`\`\`

Evaluate:
1. Did the action succeed? (true/false)
2. Did the page change as expected?
3. Would this persona notice the change? (consider their reading pattern and attention span)
4. Any unexpected side effects?

Respond in JSON:
{
  "success": true/false,
  "page_changed": true/false,
  "persona_noticed_change": true/false,
  "explanation": "brief explanation",
  "ux_issues": ["list of UX issues detected"]
}`;
}

// ── Scenario Goal Prompt ───────────────────────────────────────────────

/**
 * Generate the prompt for autonomous goal-driven testing.
 * Used when steps are not pre-defined and the agent must
 * figure out how to accomplish the goal.
 */
export function buildGoalPrompt(
	goal: string,
	persona: Persona,
	pageSnapshot: string,
	permissions: Permissions,
): string {
	const allowedOps = (["navigation", "click", "type", "submit"] as const)
		.filter((op) => permissions[op] === "allow")
		.join(", ");

	return `## Test Goal
"${goal}"

## You Are
${persona.name} — ${persona.description ?? ""}
Tech level: ${persona.demographics.tech_level} | Navigation: ${persona.cognitive_profile.navigation_strategy} | Error recovery: ${persona.cognitive_profile.error_recovery}

## Current Page
\`\`\`
${pageSnapshot}
\`\`\`

## Allowed Operations
${allowedOps}

## URL Restrictions
Allowed: ${permissions.url_allowlist.join(", ")}
${permissions.url_denylist && permissions.url_denylist.length > 0 ? `Denied: ${permissions.url_denylist.join(", ")}` : ""}

Based on the goal and your persona's cognitive profile, decide:
1. What is your next action?
2. Are you stuck? If so, what would you try?
3. How close are you to completing the goal? (0-100%)

Respond in JSON:
{
  "reasoning": "what you're thinking as this persona",
  "action": { "type": "click|type|scroll|navigate|back|give_up", "target": "...", "value": "..." },
  "stuck": false,
  "goal_progress_percent": 0-100,
  "observations": ["UX issues noticed from this persona's perspective"]
}`;
}
