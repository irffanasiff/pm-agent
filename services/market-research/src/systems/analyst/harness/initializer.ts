/**
 * Analyst Initializer
 * Sets up workspace for a new research target
 */

import type { IStore } from "../../../shared/store/types.js";
import type { IExecutor } from "../../../shared/executor/types.js";
import type { IObservability } from "../../../shared/observability/types.js";
import type { AnalystInput } from "../types.js";
import type { FeatureCategory } from "../workspace/types.js";
import { AnalystWorkspaceManager } from "../workspace/manager.js";

// ============================================
// TYPES
// ============================================

export interface InitializerDependencies {
  store: IStore;
  executor: IExecutor;
  observability: IObservability;
}

export interface InitializerResult {
  success: boolean;
  targetId: string;
  featureCount: number;
  error?: string;
}

// ============================================
// FEATURE GENERATION
// ============================================

/**
 * Generate features based on depth and focus
 */
function generateFeatures(
  subject: string,
  depth: string,
  focus?: string[]
): Array<{ name: string; description: string; category: FeatureCategory; priority: number }> {
  const features: Array<{ name: string; description: string; category: FeatureCategory; priority: number }> = [];

  // Core features (always included)
  features.push({
    name: "Background Context",
    description: `Gather background information and context about: ${subject}`,
    category: "context",
    priority: 1,
  });

  features.push({
    name: "Key Facts",
    description: `Identify and verify key facts related to: ${subject}`,
    category: "facts",
    priority: 2,
  });

  features.push({
    name: "Key Stakeholders",
    description: `Identify major parties, actors, or stakeholders involved in: ${subject}`,
    category: "stakeholders",
    priority: 3,
  });

  // Focus-based features
  if (!focus || focus.includes("timeline") || focus.includes("facts")) {
    features.push({
      name: "Timeline & Events",
      description: `Build timeline of key events and developments for: ${subject}`,
      category: "timeline",
      priority: 4,
    });
  }

  if (!focus || focus.includes("risks")) {
    features.push({
      name: "Risk Analysis",
      description: `Identify risks, uncertainties, and potential negative outcomes for: ${subject}`,
      category: "risks",
      priority: 5,
    });
  }

  if (!focus || focus.includes("opportunities")) {
    features.push({
      name: "Opportunity Analysis",
      description: `Identify opportunities and potential positive outcomes for: ${subject}`,
      category: "opportunities",
      priority: 6,
    });
  }

  if (!focus || focus.includes("prediction")) {
    features.push({
      name: "Prediction Formation",
      description: `Form predictions about likely outcomes for: ${subject}`,
      category: "predictions",
      priority: 7,
    });
  }

  // Depth-based additional features
  if (depth === "deep" || depth === "exhaustive") {
    features.push({
      name: "Source Verification",
      description: `Cross-reference and verify sources for claims about: ${subject}`,
      category: "verification",
      priority: 8,
    });

    features.push({
      name: "Counter-Arguments",
      description: `Identify and analyze counter-arguments and opposing viewpoints for: ${subject}`,
      category: "verification",
      priority: 9,
    });
  }

  if (depth === "exhaustive") {
    features.push({
      name: "Expert Opinions",
      description: `Gather expert opinions and analysis from credible sources about: ${subject}`,
      category: "sources",
      priority: 10,
    });

    features.push({
      name: "Historical Parallels",
      description: `Identify historical parallels and precedents relevant to: ${subject}`,
      category: "context",
      priority: 11,
    });

    features.push({
      name: "Scenario Analysis",
      description: `Develop multiple scenarios and their implications for: ${subject}`,
      category: "predictions",
      priority: 12,
    });
  }

  // Final synthesis feature
  features.push({
    name: "Final Synthesis",
    description: `Synthesize all findings into a comprehensive assessment of: ${subject}`,
    category: "synthesis",
    priority: 100, // Always last
  });

  return features;
}

// ============================================
// INITIALIZER
// ============================================

/**
 * Initialize a new research workspace
 */
export async function initializeWorkspace(
  input: AnalystInput,
  deps: InitializerDependencies
): Promise<InitializerResult> {
  const { store, observability } = deps;

  // Generate target ID if not provided
  const targetId = input.targetId ?? crypto.randomUUID();

  observability.log("info", `[Initializer] Starting workspace initialization`, {
    targetId,
    subject: input.subject.slice(0, 100),
    depth: input.depth,
  });

  try {
    // Create workspace manager
    const workspaceManager = new AnalystWorkspaceManager(store);

    // Check if workspace already exists
    const exists = await workspaceManager.exists(targetId);
    if (exists) {
      observability.log("info", `[Initializer] Workspace already exists`, { targetId });
      const ws = await workspaceManager.load(targetId);
      return {
        success: true,
        targetId,
        featureCount: ws?.featureList.totalCount ?? 0,
      };
    }

    // Generate features based on input
    const features = generateFeatures(input.subject, input.depth, input.focus);

    // Initialize workspace
    await workspaceManager.initialize(targetId, input.subject, features);

    observability.log("info", `[Initializer] Workspace initialized`, {
      targetId,
      featureCount: features.length,
    });

    return {
      success: true,
      targetId,
      featureCount: features.length,
    };

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    observability.log("error", `[Initializer] Failed to initialize workspace`, {
      targetId,
      error: errorMsg,
    });

    return {
      success: false,
      targetId,
      featureCount: 0,
      error: errorMsg,
    };
  }
}

/**
 * Re-initialize workspace with additional features
 * Useful for expanding research scope
 */
export async function expandWorkspace(
  targetId: string,
  additionalFeatures: Array<{ name: string; description: string; category?: FeatureCategory }>,
  deps: InitializerDependencies
): Promise<InitializerResult> {
  const { store, observability } = deps;

  observability.log("info", `[Initializer] Expanding workspace`, {
    targetId,
    additionalFeatureCount: additionalFeatures.length,
  });

  try {
    const workspaceManager = new AnalystWorkspaceManager(store);

    // Load existing workspace
    const ws = await workspaceManager.load(targetId);
    if (!ws) {
      return {
        success: false,
        targetId,
        featureCount: 0,
        error: "Workspace not found",
      };
    }

    // Add new features
    const existingIds = new Set(ws.featureList.features.map((f) => f.id));
    const maxPriority = Math.max(...ws.featureList.features.map((f) => f.priority));

    for (const [i, feature] of additionalFeatures.entries()) {
      const id = `feature_expansion_${Date.now()}_${i}`;
      if (!existingIds.has(id)) {
        ws.featureList.features.push({
          id,
          name: feature.name,
          description: feature.description,
          priority: maxPriority + i + 1,
          status: "pending",
          category: feature.category,
          attempts: 0,
        });
      }
    }

    ws.featureList.totalCount = ws.featureList.features.length;
    await workspaceManager.saveFeatureList(targetId, ws.featureList);

    await workspaceManager.appendProgress(targetId, {
      type: "note",
      message: `Workspace expanded with ${additionalFeatures.length} new features`,
      data: { newFeatures: additionalFeatures.map((f) => f.name) },
    });

    return {
      success: true,
      targetId,
      featureCount: ws.featureList.totalCount,
    };

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    observability.log("error", `[Initializer] Failed to expand workspace`, {
      targetId,
      error: errorMsg,
    });

    return {
      success: false,
      targetId,
      featureCount: 0,
      error: errorMsg,
    };
  }
}
