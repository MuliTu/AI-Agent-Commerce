# Versioning

This project follows Semantic Versioning while it is pre-1.0:

- `0.MINOR.0` adds a completed product capability.
- `0.MINOR.PATCH` fixes an existing capability without expanding its contract.
- `1.0.0` is reserved for an explicitly approved stable release.

Version changes are made in a dedicated feature or release pull request. Update
both `package.json` and `package-lock.json`, add a `CHANGELOG.md` entry, and pass
the repository checks before merge. Tags and GitHub Releases are created only
after the corresponding pull request is merged.
