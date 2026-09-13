export interface RelevanceMetrics {
  precisionAt10: number;
  recallAt10: number;
  reciprocalRank: number;
  relevantInTop10: number;
  relevantTotal: number;
}

export function evaluateRanking(
  rankedPaths: readonly string[],
  relevantPaths: ReadonlySet<string>,
): RelevanceMetrics {
  const top10 = rankedPaths.slice(0, 10);
  const relevantInTop10 = top10.filter((path) => relevantPaths.has(path)).length;
  const firstRelevantIndex = rankedPaths.findIndex((path) => relevantPaths.has(path));

  return {
    precisionAt10: relevantInTop10 / 10,
    recallAt10: relevantPaths.size > 0 ? relevantInTop10 / relevantPaths.size : 0,
    reciprocalRank: firstRelevantIndex >= 0 ? 1 / (firstRelevantIndex + 1) : 0,
    relevantInTop10,
    relevantTotal: relevantPaths.size,
  };
}

export function averageMetrics(metrics: readonly RelevanceMetrics[]): RelevanceMetrics {
  if (metrics.length === 0) {
    return {
      precisionAt10: 0,
      recallAt10: 0,
      reciprocalRank: 0,
      relevantInTop10: 0,
      relevantTotal: 0,
    };
  }

  const total = metrics.reduce(
    (sum, metric) => ({
      precisionAt10: sum.precisionAt10 + metric.precisionAt10,
      recallAt10: sum.recallAt10 + metric.recallAt10,
      reciprocalRank: sum.reciprocalRank + metric.reciprocalRank,
      relevantInTop10: sum.relevantInTop10 + metric.relevantInTop10,
      relevantTotal: sum.relevantTotal + metric.relevantTotal,
    }),
    {
      precisionAt10: 0,
      recallAt10: 0,
      reciprocalRank: 0,
      relevantInTop10: 0,
      relevantTotal: 0,
    },
  );

  return {
    precisionAt10: total.precisionAt10 / metrics.length,
    recallAt10: total.recallAt10 / metrics.length,
    reciprocalRank: total.reciprocalRank / metrics.length,
    relevantInTop10: total.relevantInTop10,
    relevantTotal: total.relevantTotal,
  };
}
