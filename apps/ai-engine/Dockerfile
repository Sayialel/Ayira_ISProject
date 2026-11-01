# The matching engine, as a release image.
#
# Three things in here are not incidental:
#
#   1. Python 3.12, matching CI and the environment every reported metric was
#      produced in. The image was on 3.11, so the deployed engine ran on a
#      different interpreter from the evaluated one -- a difference that can
#      move a float in the fourth decimal place and make a figure in the
#      write-up unreproducible rather than merely different.
#
#   2. artifacts/ is copied. tfidf_model.SERVING_PATH resolves to
#      /app/artifacts/tfidf_vectorizer.joblib, and the previous image copied
#      only app/. The promoted vectoriser was therefore absent at runtime,
#      load_serving() returned None, and score_gigs silently fell back to
#      fitting TF-IDF over whichever gigs happened to be open. The container
#      would have served a model that was never evaluated.
#
#   3. The sentence-transformer is downloaded at build time, not on the first
#      request. Otherwise a cold start fetches ~90 MB from Hugging Face while
#      a user waits, and an unreachable Hub means the engine cannot serve at
#      all. Baking it in also pins what is served to what was tested.

FROM python:3.12-slim AS base

# Model files live here rather than in a home directory that may not exist for
# the non-root user below.
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    HF_HOME=/opt/hf \
    SENTENCE_TRANSFORMERS_HOME=/opt/hf

WORKDIR /app

COPY apps/ai-engine/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-fetch the encoder. The name is passed as a build argument so it cannot
# drift from app/config.py without someone noticing the two disagree.
ARG MODEL_NAME=all-MiniLM-L6-v2
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('${MODEL_NAME}')"

COPY apps/ai-engine/app ./app
# The promoted TF-IDF vectoriser and the record of which run produced it.
COPY apps/ai-engine/artifacts ./artifacts

# Non-root. Nothing in the engine writes to disk at runtime -- embeddings are
# cached in Postgres, not locally -- so it needs no writable path of its own.
RUN useradd --system --uid 10001 ayira && chown -R ayira:ayira /app /opt/hf
USER ayira

EXPOSE 8001

# Reports readiness, which for this service means the process is answering.
# The encoder is loaded lazily on first scoring request; see embeddings.get_model.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8001/health', timeout=4).status==200 else 1)"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]
