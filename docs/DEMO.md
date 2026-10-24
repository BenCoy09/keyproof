# Demo script, 75 seconds

Record this before polishing anything. Screen capture, no voiceover needed; captions are fine.

| Time | Screen | Say or caption |
| --- | --- | --- |
| 0:00 | App loads with the example policy, red verdict already showing | "An ops person wrote this policy for an AI agent." |
| 0:08 | Scroll the policy: 5 NEAR per day, two contracts, no full access | "Five NEAR a day, two contracts, no full access key." |
| 0:15 | Verdict: 4 of 4 promises can be exceeded | "KeyProof reads the agent's real keys on chain. The prompt says one thing. The keys say another." |
| 0:25 | Open the Daily spend cap finding: allowance 12 NEAR | "This key has an allowance of 12 NEAR. The field is named next to the sentence it breaks." |
| 0:38 | Scroll the findings: full access key, no allowance cap | "A full access key and a key with no cap at all." |
| 0:48 | Switch Key source to "Snapshot, after fix" | "Now the same policy against the tightened keys." |
| 0:55 | Verdict turns green: all 4 promises hold | "Every promise holds." |
| 1:03 | Press Download report | "Read only, nothing signed, one report the auditor can sign off." |
| 1:10 | Repo URL on screen | "KeyProof. Open source, on testnet." |

If live mode works for your own testnet account, record that instead of the snapshots: show the red verdict, fix the key on chain, press Check keys again, show green. It is a stronger demo.

## X post draft

Built KeyProof at NEAR HACKATHON.

You write your AI agent's spending policy in plain English. KeyProof reads the agent's NEAR access keys and proves whether it can exceed that policy.

Prompts are not permissions. The check happens on chain.

Read only. Nothing signed. No keys requested.

[video] [repo link]

## Submission checklist

- [ ] Repository is public (judges cannot open a private one)
- [ ] README has the diagram, setup commands and "What we cut and why"
- [ ] Demo posted on X, saying you built it at NEAR HACKATHON, with video or screenshots
- [ ] Form submitted at nearhackathon.com with both links, a NEAR wallet address for the prize, and the track set to AI Security and Defense
- [ ] Submitted before 14 Nov 2026, 23:59 UTC (submissions open 1 Nov 2026, 00:00 UTC)
