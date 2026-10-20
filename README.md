# changelog-generate

Generates a per-PR changelog fragment from your commits using
[git-cliff](https://git-cliff.org/), stamps it with the PR title, and commits it
to the PR branch.

Part of the changelog actions suite:
**`changelog-generate`** → `changelog-merge` → `changelog-release` → `changelog-notify`.

## Usage

Run on pull requests. The repository must already be checked out at the PR head
with full history (`fetch-depth: 0`) so git-cliff can read commits.
The fragment covers only the commits between where the PR branched from its
base branch (`base-ref`, default `github.base_ref`) and the PR head, so commits
that earlier PRs merged but no release has tagged yet stay out of it:

```yaml
jobs:
  changelog:
    runs-on: ubuntu-latest
    if: github.event_name == 'pull_request' && github.actor != 'dependabot[bot]'
    steps:
      - uses: actions/checkout@v4
        with:
          repository: ${{ github.event.pull_request.head.repo.full_name }}
          ref: ${{ github.event.pull_request.head.ref }}
          fetch-depth: 0
          token: ${{ secrets.CHANGELOG_TOKEN || secrets.GITHUB_TOKEN }}

      - uses: uptick-dev/changelog-generate@v1
        with:
          pr-number: ${{ github.event.pull_request.number }}
          pr-title: ${{ github.event.pull_request.title }}
          config: cliff.toml
```

## Inputs

| Name | Default | Description |
| --- | --- | --- |
| `pr-number` | _(required)_ | PR number; names the fragment `{fragments-dir}/{pr-number}-CHANGES.md`. |
| `pr-title` | `""` | PR title, injected as `<!-- title: ... -->` so the merge step can group by PR. |
| `base-ref` | `${{ github.base_ref }}` | Branch the PR targets. The fragment covers only commits since the PR branched from it. Empty or unresolvable (fork PR, shallow checkout) falls back to every commit since the last tag, with a warning. |
| `base-repository` | `${{ github.repository }}` | `owner/repo` that `base-ref` is fetched from; for a fork PR this is the target repository, not the fork. |
| `config` | `cliff.toml` | git-cliff config path (project-local). |
| `fragments-dir` | `changelog` | Directory the fragment is written to. |
| `git-cliff-version` | `2.12.0` | Version of the prebuilt git-cliff binary to install. |
| `record-bump` | `"false"` | Write `<!-- bump: patch\|minor\|major (computed) -->` into the fragment for `changelog-merge`'s semver output (see below). |
| `base-sha` | `${{ github.event.pull_request.base.sha }}` | Commit the PR's commits are counted from for the bump. |
| `commit` | `"true"` | Commit and push the fragment to the PR branch. |
| `commit-message` | `Generating changelog fragment` | Commit message. |

## Outputs

| Name | Description |
| --- | --- |
| `fragment-path` | Path to this PR's fragment file. |
| `bump` | The fragment's bump, when `record-bump` is on. |
| `pushed` | `'true'` if this run pushed to the PR branch (new fragment or changed bump line). That push starts a new run, so callers can skip the rest of this one. |
| `created` | `'true'` if a new fragment was generated, `'false'` if it already existed. |

## Recording the semver bump

With `record-bump: true`, the PR's commits (`base-sha..HEAD`, merges skipped)
and title decide the bump: `!` after the type or a `BREAKING CHANGE:` footer is
`major`, `feat:` is `minor`, anything else is `patch`. The line is written under
the title comment as `<!-- bump: minor (computed) -->` and recomputed on every
push, so later commits still count. To override it, edit the line in the PR and
drop `(computed)`, e.g. `<!-- bump: patch -->`; that line is then kept.

## Notes

- **Idempotent.** If the fragment already exists (e.g. a later push to the same
  PR), it is left untouched, so manual edits to it survive (only a computed bump
  line is updated).
- **Fork PRs.** When the `CHANGELOG_TOKEN` secret is unavailable (PRs from forks),
  the commit step is best-effort — it cannot push to the fork. Keep the
  fork-aware `actions/checkout` in the caller (as shown) rather than inside the
  action.
- The PR title is passed to `awk` via an environment variable, never interpolated
  into the shell, to avoid script injection from crafted PR titles.
- git-cliff is installed via
  [`setup-git-cliff`](https://github.com/uptick-dev/setup-git-cliff) — a
  pinned, **prebuilt** binary (no Rust build, no Dependabot pinning fights),
  controlled by the `git-cliff-version` input.
