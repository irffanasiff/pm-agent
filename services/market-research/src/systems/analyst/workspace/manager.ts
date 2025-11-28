/**
 * Analyst Workspace Manager
 * Handles per-target workspace persistence
 */

import type { IStore } from "../../../shared/store/types.js";
import type {
  AnalystWorkspace,
  FeatureList,
  Feature,
  FeatureStatus,
  FeatureCategory,
  HypothesesDoc,
  Hypothesis,
  ClaimsDoc,
  Claim,
  ClaimStrength,
  ClaimSource,
  PlanDoc,
  PlanGoal,
  ProgressEntry,
  ProgressEntryType,
} from "./types.js";

// ============================================
// WORKSPACE MANAGER
// ============================================

/**
 * Manages analyst workspace files for a target
 */
export class AnalystWorkspaceManager {
  private readonly store: IStore;
  private readonly namespace: string;

  constructor(store: IStore, namespace: string = "analyst") {
    this.store = store;
    this.namespace = namespace;
  }

  // ============================================
  // WORKSPACE LIFECYCLE
  // ============================================

  /**
   * Check if workspace exists for a target
   */
  async exists(targetId: string): Promise<boolean> {
    return this.store.exists(this.key(targetId, "feature_list"));
  }

  /**
   * Initialize a new workspace for a target
   */
  async initialize(
    targetId: string,
    subject: string,
    features: Array<{ name: string; description: string; category?: FeatureCategory; priority?: number }>
  ): Promise<AnalystWorkspace> {
    const now = new Date().toISOString();

    // Create feature list
    const featureList: FeatureList = {
      schemaVersion: "feature_list_v1",
      createdAt: now,
      updatedAt: now,
      targetId,
      subject,
      features: features.map((f, i) => ({
        id: `feature_${i + 1}`,
        name: f.name,
        description: f.description,
        priority: f.priority ?? i + 1,
        status: "pending" as FeatureStatus,
        category: f.category,
        attempts: 0,
      })),
      progress: 0,
      completedCount: 0,
      totalCount: features.length,
    };

    // Create empty hypotheses doc
    const hypotheses: HypothesesDoc = {
      schemaVersion: "hypotheses_v1",
      createdAt: now,
      updatedAt: now,
      targetId,
      hypotheses: [],
      rejected: [],
    };

    // Create initial plan
    const plan: PlanDoc = {
      schemaVersion: "plan_v1",
      createdAt: now,
      updatedAt: now,
      targetId,
      currentGoals: features.slice(0, 3).map((f, i) => ({
        id: `goal_${i + 1}`,
        description: `Research: ${f.name}`,
        status: "pending" as const,
        priority: i + 1,
      })),
      completedGoals: [],
      blockers: [],
      nextSteps: [],
    };

    // Create empty claims doc
    const claims: ClaimsDoc = {
      schemaVersion: "claims_v1",
      createdAt: now,
      updatedAt: now,
      targetId,
      claims: [],
    };

    // Create initial progress entry
    const progressLog: ProgressEntry[] = [
      {
        timestamp: now,
        type: "initialized",
        message: `Workspace initialized for: ${subject}`,
        data: { featureCount: features.length },
      },
    ];

    // Save all files
    await Promise.all([
      this.store.write(this.key(targetId, "feature_list"), featureList),
      this.store.write(this.key(targetId, "hypotheses"), hypotheses),
      this.store.write(this.key(targetId, "claims"), claims),
      this.store.write(this.key(targetId, "plan"), plan),
      this.store.write(this.key(targetId, "progress"), progressLog),
    ]);

    return {
      targetId,
      featureList,
      hypotheses,
      claims,
      plan,
      progressLog,
      initialized: true,
      createdAt: now,
      lastAccessedAt: now,
    };
  }

  /**
   * Load full workspace for a target
   */
  async load(targetId: string): Promise<AnalystWorkspace | null> {
    const [featureList, hypotheses, claims, plan, progressLog] = await Promise.all([
      this.store.read<FeatureList>(this.key(targetId, "feature_list")),
      this.store.read<HypothesesDoc>(this.key(targetId, "hypotheses")),
      this.store.read<ClaimsDoc>(this.key(targetId, "claims")),
      this.store.read<PlanDoc>(this.key(targetId, "plan")),
      this.store.read<ProgressEntry[]>(this.key(targetId, "progress")),
    ]);

    if (!featureList) {
      return null;
    }

    return {
      targetId,
      featureList,
      hypotheses: hypotheses ?? this.emptyHypotheses(targetId),
      claims: claims ?? this.emptyClaims(targetId),
      plan: plan ?? this.emptyPlan(targetId),
      progressLog: progressLog ?? [],
      initialized: true,
      createdAt: featureList.createdAt,
      lastAccessedAt: new Date().toISOString(),
    };
  }

  // ============================================
  // FEATURE LIST OPERATIONS
  // ============================================

  /**
   * Load feature list
   */
  async loadFeatureList(targetId: string): Promise<FeatureList | null> {
    return this.store.read<FeatureList>(this.key(targetId, "feature_list"));
  }

  /**
   * Save feature list
   */
  async saveFeatureList(targetId: string, list: FeatureList): Promise<void> {
    list.updatedAt = new Date().toISOString();
    list.progress = list.completedCount / list.totalCount;
    await this.store.write(this.key(targetId, "feature_list"), list);
  }

  /**
   * Get next feature to work on
   */
  async getNextFeature(targetId: string): Promise<Feature | null> {
    const list = await this.loadFeatureList(targetId);
    if (!list) return null;

    // Find highest priority pending feature with satisfied dependencies
    const pending = list.features
      .filter((f) => f.status === "pending")
      .filter((f) => {
        if (!f.dependsOn || f.dependsOn.length === 0) return true;
        return f.dependsOn.every((depId) => {
          const dep = list.features.find((d) => d.id === depId);
          return dep?.status === "completed";
        });
      })
      .sort((a, b) => a.priority - b.priority);

    return pending[0] ?? null;
  }

  /**
   * Mark feature as started
   */
  async startFeature(targetId: string, featureId: string): Promise<void> {
    const list = await this.loadFeatureList(targetId);
    if (!list) return;

    const feature = list.features.find((f) => f.id === featureId);
    if (feature) {
      feature.status = "in_progress";
      feature.attempts++;
      await this.saveFeatureList(targetId, list);
      await this.appendProgress(targetId, {
        type: "feature_started",
        message: `Started: ${feature.name}`,
        featureId,
      });
    }
  }

  /**
   * Mark feature as completed
   */
  async completeFeature(
    targetId: string,
    featureId: string,
    notes?: string
  ): Promise<void> {
    const list = await this.loadFeatureList(targetId);
    if (!list) return;

    const feature = list.features.find((f) => f.id === featureId);
    if (feature) {
      feature.status = "completed";
      feature.completedAt = new Date().toISOString();
      feature.completionNotes = notes;
      list.completedCount++;
      await this.saveFeatureList(targetId, list);
      await this.appendProgress(targetId, {
        type: "feature_completed",
        message: `Completed: ${feature.name}`,
        featureId,
        data: { notes },
      });
    }
  }

  /**
   * Mark feature as failed
   */
  async failFeature(
    targetId: string,
    featureId: string,
    error: string
  ): Promise<void> {
    const list = await this.loadFeatureList(targetId);
    if (!list) return;

    const feature = list.features.find((f) => f.id === featureId);
    if (feature) {
      feature.lastError = error;
      // Mark as failed only after max attempts (3)
      if (feature.attempts >= 3) {
        feature.status = "failed";
      } else {
        feature.status = "pending"; // Will retry
      }
      await this.saveFeatureList(targetId, list);
      await this.appendProgress(targetId, {
        type: "feature_failed",
        message: `Failed: ${feature.name} (attempt ${feature.attempts})`,
        featureId,
        data: { error },
      });
    }
  }

  // ============================================
  // HYPOTHESES OPERATIONS
  // ============================================

  /**
   * Load hypotheses
   */
  async loadHypotheses(targetId: string): Promise<HypothesesDoc | null> {
    return this.store.read<HypothesesDoc>(this.key(targetId, "hypotheses"));
  }

  /**
   * Save hypotheses
   */
  async saveHypotheses(targetId: string, doc: HypothesesDoc): Promise<void> {
    doc.updatedAt = new Date().toISOString();
    await this.store.write(this.key(targetId, "hypotheses"), doc);
  }

  /**
   * Add a new hypothesis
   */
  async addHypothesis(
    targetId: string,
    statement: string,
    confidence: number,
    category?: string
  ): Promise<Hypothesis> {
    const doc = (await this.loadHypotheses(targetId)) ?? this.emptyHypotheses(targetId);
    const now = new Date().toISOString();

    const hypothesis: Hypothesis = {
      id: `hyp_${doc.hypotheses.length + 1}`,
      statement,
      confidence,
      supporting: [],
      contradicting: [],
      formedAt: now,
      lastUpdated: now,
      status: "active",
      category,
    };

    doc.hypotheses.push(hypothesis);
    await this.saveHypotheses(targetId, doc);
    await this.appendProgress(targetId, {
      type: "hypothesis_added",
      message: `New hypothesis: ${statement.slice(0, 50)}...`,
      data: { hypothesisId: hypothesis.id, confidence },
    });

    return hypothesis;
  }

  /**
   * Update hypothesis confidence
   */
  async updateHypothesisConfidence(
    targetId: string,
    hypothesisId: string,
    newConfidence: number,
    evidence?: { description: string; source?: string; strength: "strong" | "moderate" | "weak"; supporting: boolean }
  ): Promise<void> {
    const doc = await this.loadHypotheses(targetId);
    if (!doc) return;

    const hyp = doc.hypotheses.find((h) => h.id === hypothesisId);
    if (!hyp) return;

    const oldConfidence = hyp.confidence;
    hyp.confidence = newConfidence;
    hyp.lastUpdated = new Date().toISOString();

    if (evidence) {
      const evidenceEntry = {
        description: evidence.description,
        source: evidence.source,
        strength: evidence.strength,
        foundAt: new Date().toISOString(),
      };
      if (evidence.supporting) {
        hyp.supporting.push(evidenceEntry);
      } else {
        hyp.contradicting.push(evidenceEntry);
      }
    }

    // Auto-update status based on confidence
    if (newConfidence >= 0.9) {
      hyp.status = "confirmed";
    } else if (newConfidence <= 0.1) {
      hyp.status = "rejected";
      doc.rejected.push(hyp);
      doc.hypotheses = doc.hypotheses.filter((h) => h.id !== hypothesisId);
    }

    await this.saveHypotheses(targetId, doc);
    await this.appendProgress(targetId, {
      type: "hypothesis_updated",
      message: `Hypothesis confidence: ${(oldConfidence * 100).toFixed(0)}% → ${(newConfidence * 100).toFixed(0)}%`,
      data: { hypothesisId, oldConfidence, newConfidence },
    });
  }

  // ============================================
  // CLAIMS OPERATIONS
  // ============================================

  /**
   * Load claims
   */
  async loadClaims(targetId: string): Promise<ClaimsDoc | null> {
    return this.store.read<ClaimsDoc>(this.key(targetId, "claims"));
  }

  /**
   * Save claims
   */
  async saveClaims(targetId: string, doc: ClaimsDoc): Promise<void> {
    doc.updatedAt = new Date().toISOString();
    await this.store.write(this.key(targetId, "claims"), doc);
  }

  /**
   * Add a new claim
   */
  async addClaim(
    targetId: string,
    text: string,
    sources: ClaimSource[],
    options?: {
      strength?: ClaimStrength;
      tags?: string[];
      relatedHypotheses?: string[];
      date?: string;
    }
  ): Promise<Claim> {
    const doc = (await this.loadClaims(targetId)) ?? this.emptyClaims(targetId);
    const now = new Date().toISOString();

    const claim: Claim = {
      id: `claim_${doc.claims.length + 1}`,
      text,
      sources,
      strength: options?.strength ?? "medium",
      tags: options?.tags,
      relatedHypotheses: options?.relatedHypotheses,
      date: options?.date,
      addedAt: now,
      verified: false,
    };

    doc.claims.push(claim);
    await this.saveClaims(targetId, doc);
    await this.appendProgress(targetId, {
      type: "research_updated",
      message: `New claim: ${text.slice(0, 50)}...`,
      data: { claimId: claim.id, strength: claim.strength },
    });

    return claim;
  }

  /**
   * Verify a claim
   */
  async verifyClaim(
    targetId: string,
    claimId: string,
    verified: boolean,
    notes?: string
  ): Promise<void> {
    const doc = await this.loadClaims(targetId);
    if (!doc) return;

    const claim = doc.claims.find((c) => c.id === claimId);
    if (claim) {
      claim.verified = verified;
      claim.verificationNotes = notes;
      await this.saveClaims(targetId, doc);
      await this.appendProgress(targetId, {
        type: "research_updated",
        message: `Claim ${verified ? "verified" : "unverified"}: ${claim.text.slice(0, 50)}...`,
        data: { claimId, verified },
      });
    }
  }

  // ============================================
  // PLAN OPERATIONS
  // ============================================

  /**
   * Load plan
   */
  async loadPlan(targetId: string): Promise<PlanDoc | null> {
    return this.store.read<PlanDoc>(this.key(targetId, "plan"));
  }

  /**
   * Save plan
   */
  async savePlan(targetId: string, plan: PlanDoc): Promise<void> {
    plan.updatedAt = new Date().toISOString();
    await this.store.write(this.key(targetId, "plan"), plan);
  }

  /**
   * Update current goals
   */
  async updateGoals(
    targetId: string,
    goals: Array<{ description: string; status: "pending" | "in_progress" | "completed" | "blocked"; priority?: number }>
  ): Promise<void> {
    const plan = (await this.loadPlan(targetId)) ?? this.emptyPlan(targetId);

    plan.currentGoals = goals.map((g, i) => ({
      id: `goal_${Date.now()}_${i}`,
      description: g.description,
      status: g.status,
      priority: g.priority ?? i + 1,
    }));

    await this.savePlan(targetId, plan);
  }

  /**
   * Complete a goal
   */
  async completeGoal(targetId: string, goalId: string, outcome?: string): Promise<void> {
    const plan = await this.loadPlan(targetId);
    if (!plan) return;

    const goal = plan.currentGoals.find((g) => g.id === goalId);
    if (goal) {
      goal.status = "completed";
      goal.completedAt = new Date().toISOString();
      goal.outcome = outcome;
      plan.completedGoals.push(goal);
      plan.currentGoals = plan.currentGoals.filter((g) => g.id !== goalId);
      await this.savePlan(targetId, plan);
    }
  }

  // ============================================
  // PROGRESS LOG OPERATIONS
  // ============================================

  /**
   * Load progress log
   */
  async loadProgress(targetId: string): Promise<ProgressEntry[]> {
    return (await this.store.read<ProgressEntry[]>(this.key(targetId, "progress"))) ?? [];
  }

  /**
   * Append to progress log
   */
  async appendProgress(
    targetId: string,
    entry: Omit<ProgressEntry, "timestamp">
  ): Promise<void> {
    const log = await this.loadProgress(targetId);
    log.push({
      ...entry,
      timestamp: new Date().toISOString(),
    });
    await this.store.write(this.key(targetId, "progress"), log);
  }

  /**
   * Get recent progress entries
   */
  async getRecentProgress(targetId: string, count: number = 10): Promise<ProgressEntry[]> {
    const log = await this.loadProgress(targetId);
    return log.slice(-count);
  }

  // ============================================
  // HELPERS
  // ============================================

  /**
   * Build storage key
   */
  private key(targetId: string, file: string): string {
    return `${this.namespace}/${targetId}/${file}`;
  }

  /**
   * Create empty hypotheses doc
   */
  private emptyHypotheses(targetId: string): HypothesesDoc {
    const now = new Date().toISOString();
    return {
      schemaVersion: "hypotheses_v1",
      createdAt: now,
      updatedAt: now,
      targetId,
      hypotheses: [],
      rejected: [],
    };
  }

  /**
   * Create empty plan doc
   */
  private emptyPlan(targetId: string): PlanDoc {
    const now = new Date().toISOString();
    return {
      schemaVersion: "plan_v1",
      createdAt: now,
      updatedAt: now,
      targetId,
      currentGoals: [],
      completedGoals: [],
      blockers: [],
      nextSteps: [],
    };
  }

  /**
   * Create empty claims doc
   */
  private emptyClaims(targetId: string): ClaimsDoc {
    const now = new Date().toISOString();
    return {
      schemaVersion: "claims_v1",
      createdAt: now,
      updatedAt: now,
      targetId,
      claims: [],
    };
  }

  /**
   * Get workspace summary for context
   */
  async getSummary(targetId: string): Promise<string> {
    const ws = await this.load(targetId);
    if (!ws) return "No workspace found.";

    const recentProgress = ws.progressLog.slice(-5);
    const activeHypotheses = ws.hypotheses.hypotheses.filter((h) => h.status === "active");
    const pendingFeatures = ws.featureList.features.filter((f) => f.status === "pending");
    const inProgressFeatures = ws.featureList.features.filter((f) => f.status === "in_progress");

    return `
## Workspace Summary

**Subject:** ${ws.featureList.subject}
**Progress:** ${(ws.featureList.progress * 100).toFixed(0)}% (${ws.featureList.completedCount}/${ws.featureList.totalCount} features)

### Features
- In Progress: ${inProgressFeatures.map((f) => f.name).join(", ") || "None"}
- Pending: ${pendingFeatures.slice(0, 3).map((f) => f.name).join(", ")}${pendingFeatures.length > 3 ? ` (+${pendingFeatures.length - 3} more)` : ""}

### Active Hypotheses
${activeHypotheses.length > 0 ? activeHypotheses.map((h) => `- [${(h.confidence * 100).toFixed(0)}%] ${h.statement}`).join("\n") : "None yet"}

### Recent Activity
${recentProgress.map((p) => `- ${p.message}`).join("\n")}
`.trim();
  }
}

/**
 * Create workspace manager
 */
export function createWorkspaceManager(store: IStore, namespace?: string): AnalystWorkspaceManager {
  return new AnalystWorkspaceManager(store, namespace);
}
