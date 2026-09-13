# Relevance baseline

Recorded on 2026-09-13 for ScottSearch 0.1.0 plus the issue #9 evaluation harness.

- Corpus: 21 fictional Markdown notes
- Relevance cases: 5
- Hard-constraint cases: 3
- Result limit: 10
- Hybrid semantic weight: 0.8
- Semantic input: deterministic fixtures, not a measured Ollama model

| Case | Lexical P@10 | Hybrid P@10 | Lexical recall@10 | Hybrid recall@10 | Lexical MRR | Hybrid MRR |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| async-coordination | 0.200 | 0.300 | 0.667 | 1.000 | 1.000 | 1.000 |
| distributed-resilience | 0.300 | 0.300 | 1.000 | 1.000 | 0.500 | 1.000 |
| concept-retrieval | 0.200 | 0.200 | 1.000 | 1.000 | 0.250 | 1.000 |
| recovery-playbook | 0.200 | 0.200 | 1.000 | 1.000 | 0.500 | 1.000 |
| self-serve-handoff | 0.300 | 0.300 | 1.000 | 1.000 | 1.000 | 1.000 |
| **Macro average** | **0.240** | **0.260** | **0.933** | **1.000** | **0.650** | **1.000** |

All three hard-constraint cases passed: phrase + exclusion + path + created date; tag + extension + modified date; and phrase + exclusion + created date.

## Interpretation

Precision@10 has a natural ceiling in this small benchmark because each query has only two or three labeled-relevant notes and ten result positions. Hybrid ranking recovers the one relevant note lexical ranking misses, and moves a relevant note to rank one in every concept case. The large MRR change represents the main user-facing gain: less inspection before recognizing the intended note.

This is a regression baseline for ScottSearch's ranking and fusion behavior. It is not evidence about the quality, latency, memory use, or platform compatibility of a specific embedding model. Those require separate model and human-vault measurements.
