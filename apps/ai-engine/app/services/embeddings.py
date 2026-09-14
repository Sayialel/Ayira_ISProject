from sentence_transformers import SentenceTransformer
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity
from app.config import settings

_model = None


def get_model() -> SentenceTransformer:
    global _model
    if _model is None:
        _model = SentenceTransformer(settings.model_name)
    return _model


def _clamp(value: float) -> float:
    """Cosine similarity can return small negatives; scores stay in 0-1."""
    return float(max(0.0, min(1.0, value)))


def compute_semantic_similarity(text_a: str, text_b: str) -> float:
    """Sentence-BERT cosine similarity between two texts."""
    return compute_semantic_similarities(text_a, [text_b])[0]


def compute_semantic_similarities(query: str, documents: list[str]) -> list[float]:
    """
    Sentence-BERT similarity of one query against many documents.

    Encoding every document in a single batch, rather than one model call per
    pair, is what keeps a match run over a full gig list responsive.
    """
    if not documents:
        return []
    if not query.strip():
        # Nothing to compare against — fall back to a neutral score rather than
        # ranking on noise from an empty embedding.
        return [0.0] * len(documents)

    model = get_model()
    embeddings = model.encode([query] + documents)
    sims = cosine_similarity([embeddings[0]], embeddings[1:])[0]
    return [_clamp(s) for s in sims]


def compute_tfidf_similarity(text_a: str, text_b: str) -> float:
    """TF-IDF cosine similarity between two texts."""
    return compute_tfidf_similarities(text_a, [text_b])[0]


def compute_tfidf_similarities(query: str, documents: list[str]) -> list[float]:
    """
    TF-IDF similarity of one query against many documents.

    Fitting across the whole corpus at once gives meaningful document
    frequencies; fitting per pair would make every term look equally rare.
    """
    if not documents:
        return []
    if not query.strip():
        return [0.0] * len(documents)

    try:
        vectorizer = TfidfVectorizer(stop_words="english")
        matrix = vectorizer.fit_transform([query] + documents)
    except ValueError:
        # Raised when every input is empty or made up entirely of stop words,
        # which leaves the vocabulary empty. That is a "no signal" case, not an
        # error worth failing the whole match run for.
        return [0.0] * len(documents)

    sims = cosine_similarity(matrix[0:1], matrix[1:])[0]
    return [_clamp(s) for s in sims]


def composite_score(
    semantic: float,
    tfidf: float,
    location_match: bool,
    reputation: float,
) -> float:
    """
    Composite matching formula:
    0.45 * semantic + 0.25 * tfidf + 0.15 * location + 0.15 * reputation
    """
    loc = 1.0 if location_match else 0.0
    rep = min(max(reputation, 0.0) / 5.0, 1.0)  # normalise to 0-1
    return 0.45 * semantic + 0.25 * tfidf + 0.15 * loc + 0.15 * rep
