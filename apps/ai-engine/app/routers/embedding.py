import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException

from app.models.schemas import (
    EmbedGigsRequest,
    EmbedGigsResponse,
    EmbedRequest,
    EmbedResponse,
)
from app.security import require_api_key
from app.services import embeddings
from app.services.embedding_store import (
    embed_texts,
    refresh_gig_embeddings,
    text_hash,
    to_pgvector,
)
from app.services.matcher import get_supabase
from app.services.scoring import gig_text, profile_text

logger = logging.getLogger(__name__)

router = APIRouter(dependencies=[Depends(require_api_key)])

#: Only one embed at a time, process-wide.
#:
#: Not for correctness -- two embeds of different workers would both be right.
#: For memory. The process is about 130 MB idle and about 445 MB with the
#: model loaded and used, against a 512 MB limit, so a second concurrent load
#: is the one that gets the process killed. Serialising them means the peak is
#: one model, not two, whatever the caller does.
_embed_lock = asyncio.Lock()


@router.post("/embed-worker", response_model=EmbedResponse)
async def embed_worker(req: EmbedRequest) -> EmbedResponse:
    """
    Computes and stores one worker's embedding, out of band.

    WHY THIS IS A SEPARATE ENDPOINT, and not part of matching. Serving never
    loads the model: a match request that had to embed was killed by the host
    and the worker saw a 502, which is what "new workers cannot match" turned
    out to be. That constraint has not changed. What this does is move the
    embed off the request path the worker is waiting on, so the cost lands
    somewhere that can afford it.

    WHY IT EXISTS AT ALL, given eval/backfill_worker_embeddings.py already
    does this on a GitHub runner with gigabytes to spare: that workflow needs
    two repository secrets which have not been set, so it has never run. Every
    new worker has therefore depended on someone noticing and running the
    backfill by hand, and until they did, their matches were ranked on
    keywords alone and labelled 'degraded'. This removes that dependency.

    The model is released as soon as the work is done -- see
    embeddings.unload_model -- so the process returns to its idle footprint
    rather than sitting at 445 MB waiting to be killed by the next request.
    """
    async with _embed_lock:
        sb = get_supabase()

        try:
            response = (
                sb.table("users")
                .select("id, role, skills, bio, embedding_hash")
                .eq("id", req.worker_id)
                .maybe_single()
                .execute()
            )
        except Exception as exc:
            logger.exception("Could not read worker %s", req.worker_id)
            raise HTTPException(status_code=500, detail="Could not read that worker.") from exc

        worker = response.data if response else None
        if not worker:
            raise HTTPException(status_code=404, detail="Worker not found.")

        if worker.get("role") != "worker":
            # Employers have no profile text the matcher reads, so embedding
            # one would store a vector nothing will ever query.
            return EmbedResponse(worker_id=req.worker_id, embedded=False, reason="not_a_worker")

        text = profile_text(worker)
        if not text.strip():
            # profile_sufficiency reports these as 'insufficient' and the
            # interface asks for skills or a bio. An empty vector would be
            # worse than none: it would rank as confidently unlike everything.
            return EmbedResponse(
                worker_id=req.worker_id, embedded=False, reason="nothing_to_embed"
            )

        digest = text_hash(text)
        if not req.force and worker.get("embedding_hash") == digest:
            # The stored vector already matches this exact text. Loading the
            # model to recompute it would cost 300 MB to learn nothing.
            return EmbedResponse(worker_id=req.worker_id, embedded=False, reason="already_current")

        try:
            vector = embed_texts([text])[0]
            sb.table("users").update(
                {"embedding": to_pgvector(vector), "embedding_hash": digest}
            ).eq("id", req.worker_id).execute()
        except Exception as exc:
            logger.exception("Embedding failed for worker %s", req.worker_id)
            raise HTTPException(status_code=500, detail="Could not embed that profile.") from exc
        finally:
            # In `finally` on purpose: a failure part-way through still leaves
            # the model resident, and that is the state that kills the next
            # request.
            released = embeddings.unload_model()
            logger.info(
                "Embed finished for %s; model %s",
                req.worker_id,
                "released" if released else "was not held",
            )

        return EmbedResponse(worker_id=req.worker_id, embedded=True, reason="embedded")


@router.post("/embed-gigs", response_model=EmbedGigsResponse)
async def embed_gigs(req: EmbedGigsRequest) -> EmbedGigsResponse:
    """
    Embeds gigs that have no current vector.

    This used to happen inside the match request, which meant one employer
    posting a gig charged the next worker's match for a 316 MB model load.
    Serving now only counts and warns; this is where the work happens.

    A gig with no vector is not retrievable by vector search, so leaving this
    unrun quietly shrinks the catalogue from the matcher's point of view. The
    gateway calls it when a gig is published, and it is idempotent -- each gig
    is skipped unless its stored hash disagrees with its text.
    """
    async with _embed_lock:
        sb = get_supabase()

        try:
            pending = sb.rpc("gigs_needing_embedding", {"p_limit": req.limit}).execute()
        except Exception as exc:
            logger.exception("Could not list gigs needing embedding")
            raise HTTPException(status_code=500, detail="Could not list gigs.") from exc

        rows = pending.data or []
        if not rows:
            return EmbedGigsResponse(embedded=0, remaining=0)

        try:
            embedded = refresh_gig_embeddings(sb, rows, gig_text)
        except Exception as exc:
            logger.exception("Embedding gigs failed")
            raise HTTPException(status_code=500, detail="Could not embed gigs.") from exc
        finally:
            released = embeddings.unload_model()
            logger.info("Gig embed finished; model %s", "released" if released else "was not held")

        # Asked again rather than subtracted, so the number reported is the
        # database's view and not this function's arithmetic.
        try:
            still = sb.rpc("gigs_needing_embedding", {"p_limit": req.limit}).execute()
            remaining = len(still.data or [])
        except Exception:
            remaining = 0

        return EmbedGigsResponse(embedded=embedded, remaining=remaining)
