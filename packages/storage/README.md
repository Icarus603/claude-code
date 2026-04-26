# @claude-code/storage

File persistence, claudemd discovery, secure storage, gitFilesystem,
and other on-disk state utilities.

V7 §8.18 — every persistent read/write goes through this package so
file ops can be audited / sandboxed centrally.
