# Sprint II workflow

The five-stage loop the project develops in, with the actual commands, paths
and naming.

```
A. Local IDE  ->  B. GitHub  ->  C. Colab  ->  D. Drive  ->  E. Local IDE
        ^                                                         |
        +---------------------  one change at a time  ------------+
```

Protocol rules that apply at every stage: verify a path and an artefact exist
before trusting them, never overwrite raw data, keep credentials out of
notebooks and out of Git, and record the command you ran and whether it failed.

How this maps onto the institutional seven steps is in
[`apps/ai-engine/eval/WORKFLOW.md`](../apps/ai-engine/eval/WORKFLOW.md). The
rules the measurements follow are in
[EVALUATION_PROTOCOL.md](EVALUATION_PROTOCOL.md).

---

## A — Local IDE

Inspect, make **one** controlled change, test, review the diff, commit.

```bash
cd apps/ai-engine

python -m pytest                      # 103 tests, ~2.5 min
python -m eval.run_eval               # baselines on validation
python -m eval.ablation               # what each signal contributes
git diff                              # read it before committing
```

- **One change per loop.** Two changes in one run make the result
  uninterpretable, which is how a regression gets attributed to the wrong edit.
- Commit source, config and docs. Run folders are committed too, deliberately
  — the protocol requires unsuccessful runs to be preserved, and a run is only
  evidence while its log sits beside its metrics.
- `.env` is git-ignored and must stay so. The evaluation never reads it: it
  reads the committed corpus, not the live database.

A local run writes to `apps/ai-engine/eval/results/runs/<run-id>/`.

## B — GitHub

```bash
git push origin main
```

Push code, notebooks, configs, dependency pins and split manifests. The Colab
stage clones from here, so **a run in Colab can only ever reflect what has been
pushed** — this is the step people skip, and the symptom is a Colab result that
cannot be reproduced locally.

Never commit credentials, personal data, or large generated binaries. The one
committed binary is the ~26 KB TF-IDF artefact, which is small and is what the
service loads.

## C — Google Colab

`notebooks/ayira_experiment.ipynb`, regenerated from
`notebooks/build_notebook.py` so the committed notebook carries no execution
counts or output blobs.

Order matters, and the notebook enforces it:

1. **Mount Drive first.** The experiment **refuses to start** in Colab without
   it — a run saved only to the Colab runtime vanishes with the session, which
   is the one failure that leaves a number with no evidence behind it.
2. **Clone at a known commit.** Set `COMMIT` to reproduce an earlier run
   exactly; leave it empty for the tip of `main`.
3. **Install `requirements-eval.txt`** and check `pip check`. Colab ships its
   own numpy and installing matplotlib will upgrade it past the pin if allowed
   — this already happened once and the manifest caught it.
4. **Confirm the environment** — commit, dataset version, split sizes,
   resolved dependency versions — *before* spending time on a run.
5. Run the experiments. Each writes a run folder to Drive.

No credentials are needed at any point.

If a notebook's source changes, regenerate and commit it from stage A rather
than saving from Colab:

```bash
python notebooks/build_notebook.py
```

## D — Google Drive

Run folders land in `MyDrive/ayira/runs/<run-id>/`, where

```
<run-id> = <UTC timestamp>__<experiment name>__<short commit>
```

so a folder is identifiable from its name alone. Each holds:

| file | what it is |
|---|---|
| `manifest.json` | commit, dirty state, dataset version, seeds, parameters, dependencies, environment |
| `metrics.json` / `metrics.txt` | the numbers, and the printed table |
| `predictions.json` | the top 10 per profile, per strategy |
| `tfidf_vectorizer.joblib` | the preprocessing artefact |
| `splits.json` | the split assignment used |
| `*.png` | the plots |
| `run.log` | the run's own log |

Every artefact is tied to a commit, dataset hash, split and seed through the
manifest. **Keep unsuccessful runs** — a change that did not work is evidence
about the problem, and deleting it is how the same idea gets tried three times.

Use Drive's access controls for anything sensitive. Nothing in these folders is
personal data today, because the evaluation reads only the synthetic corpus.

## E — Local IDE again

Drive syncs to the desktop, so the evidence is readable without re-running
anything.

```bash
python -m eval.compare --list
python -m eval.compare <baseline-run> <candidate-run>
```

- **Compare only compatible runs.** `eval.compare` refuses to subtract runs
  whose dataset versions or splits differ, because that difference would look
  like a result without being one.
- **Never infer a metric from a filename.** Read `metrics.json`.
- Inspect `predictions.json` for the cases that went wrong, not just the
  aggregate. A mean hides exactly the failures worth fixing.
- Then propose **one** change, and go back to stage A.

### Deploying a result

Separate from evaluating one, so an exploratory run cannot change what the
service does:

```bash
python -m eval.promote                 # runs with a promotable artefact
python -m eval.promote <run-id>        # deploy it
python -m eval.promote --status        # what is deployed, and from where
python -m eval.promote --rollback      # undo the last promotion
```

`promote` refuses a run from a modified working tree, verifies the artefact
loads before overwriting what is serving, keeps the previous artefact for
rollback, and warns when the deployed artefact was fitted on a corpus that no
longer exists.

---

## Quick reference

| I want to | command |
|---|---|
| rebuild the corpus and splits | `python -m eval.corpus_sources.build_corpus` |
| run the tests | `python -m pytest` |
| measure against baselines | `python -m eval.run_eval` |
| see what each signal adds | `python -m eval.ablation` |
| choose weights | `python -m eval.tune_weights` |
| size the shortlist | `python -m eval.retrieval_eval` |
| list or compare runs | `python -m eval.compare --list` |
| check or change what is serving | `python -m eval.promote --status` |
| regenerate the Colab notebook | `python notebooks/build_notebook.py` |

All from `apps/ai-engine`, except the last which runs from the repository root.
