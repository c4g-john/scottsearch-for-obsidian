# Raft consensus

A replicated log chooses a leader and commits an entry after a majority acknowledges it. Terms prevent an older leader from overwriting newer state, allowing the cluster to tolerate unavailable nodes while preserving one ordered history.
