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
| `commit` | `"true"` | Commit and push the fragment to the PR branch. |
| `commit-message` | `Generating changelog fragment` | Commit message. |

## Outputs

| Name | Description |
| --- | --- |
| `fragment-path` | Path to this PR's fragment file. |
| `created` | `'true'` if a new fragment was generated, `'false'` if it already existed. |

## Notes

- **Idempotent.** If the fragment already exists (e.g. a later push to the same
  PR), it is left untouched, so manual edits to it survive.
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
