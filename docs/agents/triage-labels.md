# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

## How a label is actually applied here

The tracker is local markdown (see `issue-tracker.md`), not GitHub Issues — so
applying a label is **not** `gh issue edit --add-label`. It is the `Status:`
line near the top of the issue file, holding one of the strings from the
right-hand column above. Editing that line is the whole operation.

The GitHub repo does carry a stock `wontfix` label, unrelated to these skills
and unused by them. Don't let its existence pull triage back onto `gh`.

Edit the right-hand column to match whatever vocabulary you actually use.
