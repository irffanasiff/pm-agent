/**
 * End-to-End Harness Test
 * Tests the full analyst workflow with mock dependencies
 *
 * Run with: npx tsx src/systems/analyst/harness/test-harness.ts
 */

import type { IStore } from "../../../shared/store/types.js";
import type { IExecutor, ExecutorResponse } from "../../../shared/executor/types.js";
import type { IObservability, SessionResult, SpanHandle } from "../../../shared/observability/types.js";
import type { ResearcherOutput } from "../agents/researcher/types.js";
import { initializeWorkspace } from "./initializer.js";
import { runWorker, runWorkerLoop } from "./worker.js";
import { AnalystWorkspaceManager } from "../workspace/manager.js";

// ============================================
// MOCK IMPLEMENTATIONS
// ============================================

/**
 * In-memory store for testing
 */
class MockStore implements IStore {
  private data: Map<string, unknown> = new Map();
  private basePath: string;

  constructor(basePath: string = "/tmp/test-workspace") {
    this.basePath = basePath;
  }

  async read<T>(key: string): Promise<T | null> {
    return (this.data.get(key) as T) ?? null;
  }

  async write<T>(key: string, data: T): Promise<void> {
    this.data.set(key, data);
  }

  async exists(key: string): Promise<boolean> {
    return this.data.has(key);
  }

  async delete(key: string): Promise<boolean> {
    return this.data.delete(key);
  }

  async list(pattern?: string): Promise<string[]> {
    const keys = Array.from(this.data.keys());
    if (!pattern) return keys;
    const regex = new RegExp(pattern.replace(/\*/g, ".*"));
    return keys.filter((k) => regex.test(k));
  }

  getPath(key: string): string {
    return `${this.basePath}/${key}.json`;
  }

  // For testing: inspect stored data
  getAllData(): Record<string, unknown> {
    return Object.fromEntries(this.data);
  }
}

/**
 * Mock executor that returns canned responses
 */
class MockExecutor implements IExecutor {
  private callCount = 0;
  private responses: ExecutorResponse[];

  constructor(responses?: ExecutorResponse[]) {
    this.responses = responses ?? [this.defaultResponse()];
  }

  async execute(): Promise<ExecutorResponse> {
    const response = this.responses[this.callCount % this.responses.length];
    this.callCount++;
    return response;
  }

  isReady(): boolean {
    return true;
  }

  getCallCount(): number {
    return this.callCount;
  }

  private defaultResponse(): ExecutorResponse {
    return {
      success: true,
      output: "Research completed",
      costUsd: 0.05,
      durationMs: 1000,
      tokens: { input: 500, output: 300 },
      toolsUsed: ["WebSearch"],
      turns: 3,
    };
  }
}

/**
 * Mock observability that logs to console
 */
class MockObservability implements IObservability {
  private sessions: Map<string, { params: unknown; result?: SessionResult }> = new Map();
  private events: Array<{ type: string; data?: unknown }> = [];
  private logs: Array<{ level: string; message: string; data?: unknown }> = [];

  async startSession(params: { agentName: string; correlationId: string }): Promise<string> {
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    this.sessions.set(sessionId, { params });
    return sessionId;
  }

  async endSession(sessionId: string, result: SessionResult): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.result = result;
    }
  }

  async recordEvent(event: { type: string; data?: Record<string, unknown> }): Promise<void> {
    this.events.push({ type: event.type, data: event.data });
  }

  log(level: string, message: string, data?: Record<string, unknown>): void {
    this.logs.push({ level, message, data });
    if (process.env.VERBOSE) {
      console.log(`[${level.toUpperCase()}] ${message}`, data ?? "");
    }
  }

  metric(_name: string, _value: number, _tags?: Record<string, string>): void {
    // No-op for testing
  }

  startSpan(name: string): SpanHandle {
    return {
      spanId: `span_${Date.now()}`,
      name,
      startTime: Date.now(),
    };
  }

  endSpan(): void {
    // No-op
  }

  // For testing: inspect collected data
  getSessions(): Map<string, { params: unknown; result?: SessionResult }> {
    return this.sessions;
  }

  getEvents(): Array<{ type: string; data?: unknown }> {
    return this.events;
  }

  getLogs(): Array<{ level: string; message: string; data?: unknown }> {
    return this.logs;
  }
}

// ============================================
// TEST HELPERS
// ============================================

function createMockResearcherOutput(featureName: string): ResearcherOutput {
  return {
    summary: `Research completed for ${featureName}. Found key insights about the topic.`,
    findings: {
      keyPoints: [
        {
          point: `Key finding about ${featureName}`,
          confidence: "high",
          evidence: ["Source 1", "Source 2"],
          category: "facts",
        },
        {
          point: `Secondary finding related to ${featureName}`,
          confidence: "medium",
          evidence: ["Source 3"],
        },
      ],
      perspectives: {
        supporting: [
          {
            claim: "This supports the hypothesis",
            confidence: "high",
            source: "Expert Analysis",
            strength: "strong",
          },
        ],
        opposing: [
          {
            claim: "Counter-argument to consider",
            confidence: "medium",
            source: "Alternative View",
            strength: "moderate",
          },
        ],
      },
      risks: [
        {
          type: "market",
          description: "Potential market volatility",
          severity: "medium",
          likelihood: "possible",
        },
      ],
    },
    assessment: {
      conclusion: `Based on research, ${featureName} shows positive indicators`,
      confidence: 0.75,
      reasoning: "Multiple sources confirm the findings",
      prediction: {
        outcome: "Positive outcome expected",
        probability: 0.65,
        timeframe: "Next 30 days",
        assumptions: ["Market conditions remain stable"],
      },
    },
    sources: [
      {
        title: "Source 1",
        url: "https://example.com/source1",
        type: "news",
        retrievedAt: new Date().toISOString(),
        relevance: "high",
        credibility: "high",
      },
      {
        title: "Source 2",
        url: "https://example.com/source2",
        type: "analysis",
        retrievedAt: new Date().toISOString(),
        relevance: "medium",
        credibility: "medium",
      },
    ],
  };
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

// ============================================
// TESTS
// ============================================

async function testWorkspaceInitialization(): Promise<void> {
  console.log("\n=== Test: Workspace Initialization ===\n");

  const store = new MockStore();
  const executor = new MockExecutor();
  const observability = new MockObservability();

  const result = await initializeWorkspace(
    {
      subject: "Test Subject: AI Safety",
      depth: "standard",
      focus: ["facts", "risks"],
    },
    { store, executor, observability }
  );

  assert(result.success, "Initialization should succeed");
  assert(result.featureCount > 0, "Features should be created");

  // Load workspace to verify
  const workspaceManager = new AnalystWorkspaceManager(store);
  const workspace = await workspaceManager.load(result.targetId);

  assert(workspace !== null, "Workspace should be loadable");
  assert(workspace!.featureList.subject === "Test Subject: AI Safety", "Subject should match");

  console.log(`✓ Created workspace with ${result.featureCount} features`);
  console.log(`✓ Features: ${workspace!.featureList.features.map((f: { name: string }) => f.name).join(", ")}`);
}

async function testWorkerSingleIteration(): Promise<void> {
  console.log("\n=== Test: Worker Single Iteration ===\n");

  const store = new MockStore();
  const executor = new MockExecutor();
  const observability = new MockObservability();

  // Initialize workspace first
  const initResult = await initializeWorkspace(
    {
      subject: "Federal Reserve Interest Rate Decision",
      depth: "standard",
    },
    { store, executor, observability }
  );

  assert(initResult.success, "Initialization should succeed");
  const targetId = initResult.targetId!;

  // Create a mock executor that returns realistic research output
  const mockOutput = createMockResearcherOutput("Background Context");

  // We need to mock the store to return the research output when the agent "writes" to it
  // The worker will call the researcher, which writes output to store
  // For this test, we'll pre-populate what the agent would write
  await store.write(`analyst/${targetId}/research`, mockOutput);

  // Run single worker iteration
  const workerResult = await runWorker(targetId, { store, executor, observability });

  console.log(`✓ Worker completed: success=${workerResult.success}`);
  console.log(`✓ Feature worked on: ${workerResult.feature?.name ?? "none"}`);
  console.log(`✓ Progress: ${(workerResult.progress * 100).toFixed(0)}%`);
  console.log(`✓ Has more work: ${workerResult.hasMoreWork}`);

  // Verify workspace was updated
  const workspaceManager = new AnalystWorkspaceManager(store);
  const workspace = await workspaceManager.load(targetId);

  assert(workspace !== null, "Workspace should exist");
  assert(workspace!.progressLog.length > 1, "Progress log should have entries");

  console.log(`✓ Progress log has ${workspace!.progressLog.length} entries`);
}

async function testWorkerWithHypotheses(): Promise<void> {
  console.log("\n=== Test: Worker Updates Hypotheses ===\n");

  const store = new MockStore();
  const executor = new MockExecutor();
  const observability = new MockObservability();

  // Initialize workspace
  const initResult = await initializeWorkspace(
    {
      subject: "Bitcoin ETF Approval Impact",
      depth: "quick",
    },
    { store, executor, observability }
  );

  const targetId = initResult.targetId!;
  const workspaceManager = new AnalystWorkspaceManager(store);

  // Add a hypothesis to track
  await workspaceManager.addHypothesis(
    targetId,
    "Bitcoin ETF approval will lead to significant price increase",
    0.6,
    "prediction"
  );

  // Create mock output with supporting evidence
  const mockOutput = createMockResearcherOutput("Market Impact");
  mockOutput.findings.perspectives.supporting = [
    {
      claim: "Bitcoin ETF approval will lead to significant price increase based on historical patterns",
      confidence: "high",
      source: "Market Analysis",
      strength: "strong",
    },
  ];

  await store.write(`analyst/${targetId}/research`, mockOutput);

  // Run worker
  await runWorker(targetId, { store, executor, observability });

  // Check if hypothesis was updated
  const hypotheses = await workspaceManager.loadHypotheses(targetId);
  const hypothesis = hypotheses?.hypotheses.find((h) => h.statement.includes("Bitcoin ETF"));

  console.log(`✓ Original hypothesis confidence: 60%`);
  console.log(`✓ Updated hypothesis confidence: ${((hypothesis?.confidence ?? 0) * 100).toFixed(0)}%`);
  console.log(`✓ Hypothesis has ${hypothesis?.supporting.length ?? 0} supporting evidence(s)`);
}

async function testWorkerExtractsClaims(): Promise<void> {
  console.log("\n=== Test: Worker Extracts Claims ===\n");

  const store = new MockStore();
  const executor = new MockExecutor();
  const observability = new MockObservability();

  // Initialize workspace
  const initResult = await initializeWorkspace(
    {
      subject: "Climate Change Policy",
      depth: "quick",
    },
    { store, executor, observability }
  );

  const targetId = initResult.targetId!;

  // Create mock output with high-confidence key points
  const mockOutput = createMockResearcherOutput("Policy Analysis");
  mockOutput.findings.keyPoints = [
    {
      point: "Paris Agreement targets require 45% emissions reduction by 2030",
      confidence: "high",
      evidence: ["IPCC Report", "UN Climate Action"],
      category: "facts",
    },
    {
      point: "Current pledges are insufficient to meet 1.5°C target",
      confidence: "high",
      evidence: ["Climate Analytics"],
      category: "risks",
    },
  ];
  mockOutput.sources = [
    {
      title: "IPCC Report",
      type: "official",
      retrievedAt: new Date().toISOString(),
      relevance: "high",
      credibility: "high",
    },
    {
      title: "UN Climate Action",
      type: "official",
      retrievedAt: new Date().toISOString(),
      relevance: "high",
      credibility: "high",
    },
    {
      title: "Climate Analytics",
      type: "analysis",
      retrievedAt: new Date().toISOString(),
      relevance: "high",
      credibility: "medium",
    },
  ];

  await store.write(`analyst/${targetId}/research`, mockOutput);

  // Run worker
  await runWorker(targetId, { store, executor, observability });

  // Check if claims were extracted
  const workspaceManager = new AnalystWorkspaceManager(store);
  const claims = await workspaceManager.loadClaims(targetId);

  console.log(`✓ Extracted ${claims?.claims.length ?? 0} claims from research`);
  claims?.claims.forEach((c, i) => {
    console.log(`  ${i + 1}. [${c.strength}] ${c.text.slice(0, 50)}...`);
  });
}

async function testWorkerLoop(): Promise<void> {
  console.log("\n=== Test: Worker Loop ===\n");

  const store = new MockStore();
  const executor = new MockExecutor();
  const observability = new MockObservability();

  // Initialize workspace with few features for quick test
  const initResult = await initializeWorkspace(
    {
      subject: "Quick Test Subject",
      depth: "quick",
    },
    { store, executor, observability }
  );

  const targetId = initResult.targetId!;

  // Pre-populate research outputs for each iteration
  const mockOutput = createMockResearcherOutput("Test Feature");
  await store.write(`analyst/${targetId}/research`, mockOutput);

  // Run worker loop with tight limits
  const loopResult = await runWorkerLoop(targetId, { store, executor, observability }, {
    maxIterations: 3,
    maxTotalCostUsd: 1.0,
    maxTotalDurationMs: 30000,
  });

  console.log(`✓ Loop completed: success=${loopResult.success}`);
  console.log(`✓ Iterations: ${loopResult.iterations}`);
  console.log(`✓ Final progress: ${(loopResult.finalProgress * 100).toFixed(0)}%`);
  console.log(`✓ Total duration: ${loopResult.totalDurationMs}ms`);
}

async function testWorkspaceSummary(): Promise<void> {
  console.log("\n=== Test: Workspace Summary ===\n");

  const store = new MockStore();
  const executor = new MockExecutor();
  const observability = new MockObservability();

  // Initialize workspace
  const initResult = await initializeWorkspace(
    {
      subject: "Market Analysis Summary Test",
      depth: "standard",
    },
    { store, executor, observability }
  );

  const targetId = initResult.targetId!;
  const workspaceManager = new AnalystWorkspaceManager(store);

  // Add some hypotheses
  await workspaceManager.addHypothesis(
    targetId,
    "Markets will rally in Q4",
    0.65,
    "prediction"
  );

  // Get summary
  const summary = await workspaceManager.getSummary(targetId);

  console.log("Workspace Summary:");
  console.log(summary);
  console.log("\n✓ Summary generated successfully");
}

// ============================================
// MAIN
// ============================================

async function runAllTests(): Promise<void> {
  console.log("╔══════════════════════════════════════════╗");
  console.log("║   Analyst Harness End-to-End Tests       ║");
  console.log("╚══════════════════════════════════════════╝");

  const tests = [
    { name: "Workspace Initialization", fn: testWorkspaceInitialization },
    { name: "Worker Single Iteration", fn: testWorkerSingleIteration },
    { name: "Worker Updates Hypotheses", fn: testWorkerWithHypotheses },
    { name: "Worker Extracts Claims", fn: testWorkerExtractsClaims },
    { name: "Worker Loop", fn: testWorkerLoop },
    { name: "Workspace Summary", fn: testWorkspaceSummary },
  ];

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    try {
      await test.fn();
      passed++;
    } catch (error) {
      failed++;
      console.error(`\n✗ Test "${test.name}" failed:`);
      console.error(error instanceof Error ? error.message : error);
    }
  }

  console.log("\n" + "═".repeat(44));
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log("═".repeat(44));

  if (failed > 0) {
    process.exit(1);
  }
}

runAllTests().catch(console.error);
