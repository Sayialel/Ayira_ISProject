# The matching engine, as a Hugging Face Space.
#
# Same release image as apps/ai-engine/Dockerfile, with three differences that
# the Space runtime requires:
#
#   1. Port 7860, which is what Spaces routes to, declared in README.md as
#      `app_port: 7860`.
#   2. Paths are relative to the Space root rather than the monorepo root,
#      because a Space repository contains only this service.
#   3. The user is uid 1000 and named `user`, which is the account Spaces
#      expects to own the application files.
#
# Everything that matters is unchanged, and for the same reasons:
#
#   - Python 3.12, matching CI and the environment every reported metric was
#     produced in. A different interpreter can move a float in the fourth
#     decimal place and make a figure in the write-up unreproducible.
#   - artifacts/ is copied. tfidf_model.SERVING_PATH resolves to
#     <root>/artifacts/tfidf_vectorizer.joblib, and without it load_serving()
#     returns None and score_gigs silently falls back to fitting TF-IDF over
#     whichever gigs happen to be open -- serving a model that was never
#     evaluated, with only a warning line to say so.
#   - The encoder is fetched at build time, not on the first request. A Space
#     sleeps when idle, so cold starts are common here; downloading ~90 MB
#     inside one would make the first match after every nap far worse.
#
# Files this expects at the Space root, copied from apps/ai-engine/:
#     requirements.txt   app/   artifacts/

FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    HF_HOME=/opt/hf \
    SENTENCE_TRANSFORMERS_HOME=/opt/hf

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

ARG MODEL_NAME=all-MiniLM-L6-v2
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('${MODEL_NAME}')"

COPY app ./app
COPY artifacts ./artifacts

# uid 1000 named `user`: the account Spaces expects. Nothing here writes to
# disk at runtime -- embeddings are cached in Postgres, not locally -- so it
# needs no writable path of its own beyond the model cache.
RUN useradd -m -u 1000 user && chown -R user:user /app /opt/hf
USER user

EXPOSE 7860

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "7860"]
