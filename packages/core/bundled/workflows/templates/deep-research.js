export const meta = {
  name: 'deep-research',
  description: 'Deep research harness — fan-out web searches, fetch sources, adversarially verify claims, synthesize a cited report.',
  whenToUse: 'When the user wants a deep, multi-source, fact-checked research report on any topic. BEFORE invoking, check if the question is specific enough to research directly — if underspecified (e.g., "what car to buy" without budget/use-case/region), ask 2-3 clarifying questions to narrow scope. Then pass the refined question as args, weaving the answers in.',
  phases: [{"title":"Scope","detail":"Decompose question (from args) into 5 search angles","agents":1},{"title":"Search","detail":"5 parallel WebSearch agents; results stream into Fetch as they arrive","agents":5},{"title":"Fetch","detail":"URL-dedup, fetch top sources (budget 15), extract falsifiable claims","agents":20},{"title":"Verify","detail":"Streaming verify as claims arrive; 3-vote adversarial with early exit at 2/3 refutes","agents":75},{"title":"Synthesize","detail":"Merge semantic dupes, rank by confidence, cite sources","agents":1}],
}

// deep-research: Scope → stream(Search → Fetch+Extract → Verify) → Synthesize
// Search results enqueue fetches immediately; claims verify as soon as ranked in top-K.
// Ported from bughunter architecture. WebSearch/WebFetch instead of git/grep.
// Question is passed via Workflow({name: 'deep-research', args: '<question>'}).

function resolveQuestion(args) {
  if (typeof args === 'string' && args.trim()) return args.trim()
  if (args && typeof args === 'object') {
    const q = args.query ?? args.question
    if (typeof q === 'string' && q.trim()) return q.trim()
  }
  return ''
}

function fetchAgentLabel(url) {
  try {
    const u = new URL(url)
    const host = u.hostname.replace(/^www\./, '')
    const leaf = u.pathname.replace(/\/$/, '').split('/').filter(Boolean).pop() ?? ''
    const slug = leaf ? leaf.slice(0, 20) : 'root'
    return 'fetch:' + host + '/' + slug
  } catch {
    return 'fetch:unknown'
  }
}

/** Bounded async worker pool for dynamic enqueue (search→fetch, fetch→verify). */
function createPool(concurrency) {
  let active = 0
  const pending = []
  const tracked = new Set()

  function pump() {
    while (active < concurrency && pending.length > 0) {
      active++
      const { fn, resolve, reject } = pending.shift()
      Promise.resolve()
        .then(fn)
        .then(resolve, reject)
        .finally(() => {
          active--
          pump()
        })
    }
  }

  return {
    run(fn) {
      const p = new Promise((resolve, reject) => {
        pending.push({ fn, resolve, reject })
        pump()
      })
      tracked.add(p)
      p.finally(() => tracked.delete(p))
      return p
    },
    idle() {
      return Promise.all([...tracked])
    },
  }
}

const VOTES_PER_CLAIM = 3
const REFUTATIONS_REQUIRED = 2
const MAX_FETCH = 15
const MAX_VERIFY_CLAIMS = 25
const SEARCH_CONCURRENCY = 5
const FETCH_CONCURRENCY = 10
const VERIFY_CONCURRENCY = 8

// ─── Schemas ───
const SCOPE_SCHEMA = {
  type: "object", required: ["question", "angles", "summary"],
  properties: {
    question: { type: "string" },
    summary: { type: "string" },
    angles: { type: "array", minItems: 3, maxItems: 6, items: {
      type: "object", required: ["label", "query"],
      properties: {
        label: { type: "string" },
        query: { type: "string" },
        rationale: { type: "string" },
      },
    }},
  },
}
const SEARCH_SCHEMA = {
  type: "object", required: ["results"],
  properties: {
    results: { type: "array", maxItems: 6, items: {
      type: "object", required: ["url", "title", "relevance"],
      properties: {
        url: { type: "string" },
        title: { type: "string" },
        snippet: { type: "string" },
        relevance: { enum: ["high", "medium", "low"] },
      },
    }},
  },
}
const EXTRACT_SCHEMA = {
  type: "object", required: ["claims", "sourceQuality"],
  properties: {
    sourceQuality: { enum: ["primary", "secondary", "blog", "forum", "unreliable"] },
    publishDate: { type: "string" },
    claims: { type: "array", maxItems: 5, items: {
      type: "object", required: ["claim", "quote", "importance"],
      properties: {
        claim: { type: "string" },
        quote: { type: "string" },
        importance: { enum: ["central", "supporting", "tangential"] },
      },
    }},
  },
}
const VERDICT_SCHEMA = {
  type: "object", required: ["refuted", "evidence", "confidence"],
  properties: {
    refuted: { type: "boolean" },
    evidence: { type: "string" },
    confidence: { enum: ["high", "medium", "low"] },
    counterSource: { type: "string" },
  },
}
const REPORT_SCHEMA = {
  type: "object", required: ["summary", "findings", "caveats"],
  properties: {
    summary: { type: "string" },
    findings: { type: "array", items: {
      type: "object", required: ["claim", "confidence", "sources", "evidence"],
      properties: {
        claim: { type: "string" },
        confidence: { enum: ["high", "medium", "low"] },
        sources: { type: "array", items: { type: "string" } },
        evidence: { type: "string" },
        vote: { type: "string" },
      },
    }},
    caveats: { type: "string" },
    openQuestions: { type: "array", items: { type: "string" } },
  },
}

// ─── Phase 0: Scope — decompose question into search angles ───
phase("Scope")
const QUESTION = resolveQuestion(args)
if (!QUESTION) {
  return { error: "No research question provided. Pass it as args: Workflow({name: 'deep-research', args: '<question>'})." }
}
const scope = await agent(
  "Decompose this research question into complementary search angles.\n\n" +
  "## Question\n" + QUESTION + "\n\n" +
  "## Task\n" +
  "Generate 5 distinct web search queries that together cover the question from different angles. Pick angles that suit the question's domain. Examples:\n" +
  "- broad/primary  · academic/technical  · recent news  · contrarian/skeptical  · practitioner/implementation\n" +
  "- For medical: anatomy · common causes · serious differentials · authoritative refs · red flags\n" +
  "- For tech: state-of-art · benchmarks · limitations · industry adoption · cost/tradeoffs\n\n" +
  "Make queries specific enough to surface high-signal results. Avoid redundancy.\n" +
  "Return: the question (verbatim or lightly normalized), a 1-2 sentence decomposition strategy, and the angles.\n\nStructured output only.",
  { label: "scope", phase: "Scope", schema: SCOPE_SCHEMA }
)
if (!scope) {
  return { error: "Scope agent returned no result — cannot decompose the research question." }
}
log("Q: " + QUESTION.slice(0, 80) + (QUESTION.length > 80 ? "…" : ""))
log("Decomposed into " + scope.angles.length + " angles: " + scope.angles.map(a => a.label).join(", "))

// ─── Dedup / ranking state — shared across streaming search→fetch→verify ───
const normURL = u => {
  try {
    const p = new URL(u)
    return (p.hostname.replace(/^www\./, "") + p.pathname.replace(/\/$/, "")).toLowerCase()
  } catch { return u.toLowerCase() }
}
const seen = new Map()
const dupes = []
const budgetDropped = []
const relRank = { high: 0, medium: 1, low: 2 }
const impRank = { central: 0, supporting: 1, tangential: 2 }
const qualRank = { primary: 0, secondary: 1, blog: 2, forum: 3, unreliable: 4 }
let fetchSlots = MAX_FETCH

const allSources = []
const allClaims = []
const voted = []
let totalVotesCast = 0
const verifyStarted = new Set()

let fetchPhaseStarted = false
let verifyPhaseStarted = false

const fetchPool = createPool(FETCH_CONCURRENCY)
const verifyPool = createPool(VERIFY_CONCURRENCY)

function claimKey(claim) {
  return normURL(claim.sourceUrl) + "::" + claim.claim
}

function rankClaims(claims) {
  return [...claims]
    .sort((a, b) => (impRank[a.importance] - impRank[b.importance]) || (qualRank[a.sourceQuality] - qualRank[b.sourceQuality]))
    .slice(0, MAX_VERIFY_CLAIMS)
}

// ─── Prompts ───
const SEARCH_PROMPT = (angle) =>
  "## Web Searcher: " + angle.label + "\n\n" +
  "Research question: \"" + QUESTION + "\"\n\n" +
  "Your angle: **" + angle.label + "** — " + (angle.rationale || "") + "\n" +
  "Search query: `" + angle.query + "`\n\n" +
  "## Task\nUse WebSearch with the query above (or a refined version). Return the top 4-6 most relevant results.\n" +
  "Rank by relevance to the ORIGINAL question, not just the search query. Skip obvious SEO spam/content farms.\n" +
  "Include a short snippet capturing why each result is relevant.\n\nStructured output only."

const FETCH_PROMPT = (source, angle) =>
  "## Source Extractor\n\n" +
  "Research question: \"" + QUESTION + "\"\n\n" +
  "Fetch and extract key claims from this source:\n" +
  "**URL:** " + source.url + "\n**Title:** " + source.title + "\n**Found via:** " + angle + " search\n\n" +
  "## Task\n1. Use WebFetch to retrieve the page content.\n" +
  "2. Assess source quality: primary research/institution? secondary reporting? blog/opinion? forum? unreliable?\n" +
  "3. Extract 2-5 FALSIFIABLE claims that bear on the research question. Each claim must:\n" +
  "   - be a concrete, checkable statement (not vague generalities)\n" +
  "   - include a direct quote from the source as support\n" +
  "   - be rated central/supporting/tangential to the research question\n" +
  "4. Note publish date if available.\n\n" +
  "If the fetch fails or the page is irrelevant/paywalled, return claims: [] and sourceQuality: \"unreliable\".\n\nStructured output only."

const VERIFY_PROMPT = (claim, v) =>
  "## Adversarial Claim Verifier (voter " + (v + 1) + "/" + VOTES_PER_CLAIM + ")\n\n" +
  "Be SKEPTICAL. Try to REFUTE this claim. ≥" + REFUTATIONS_REQUIRED + "/" + VOTES_PER_CLAIM + " refutations kill it.\n\n" +
  "## Research question\n" + QUESTION + "\n\n" +
  "## Claim under review\n\"" + claim.claim + "\"\n\n" +
  "**Source:** " + claim.sourceUrl + " (" + claim.sourceQuality + ")\n" +
  "**Supporting quote:** \"" + claim.quote + "\"\n\n" +
  "## Checklist\n" +
  "1. Is the claim actually supported by the quote, or is it an overreach/misread?\n" +
  "2. WebSearch for contradicting evidence — does any credible source dispute or heavily qualify this?\n" +
  "3. Is the source quality sufficient for the claim's strength? (extraordinary claims need primary sources)\n" +
  "4. Is the claim outdated? (check dates — old claims about fast-moving fields are suspect)\n" +
  "5. Is this a marketing claim / press release / cherry-picked benchmark / forum speculation?\n\n" +
  "**refuted=true** if: unsupported by quote / contradicted / low-quality source for strong claim / outdated / marketing fluff.\n" +
  "**refuted=false** ONLY if: claim is well-supported, current, and source quality matches claim strength.\n" +
  "Default to refuted=true if uncertain.\n\nStructured output only. Evidence MUST be specific."

function ensureFetchPhase() {
  if (!fetchPhaseStarted) {
    fetchPhaseStarted = true
    phase("Fetch")
  }
}

function ensureVerifyPhase() {
  if (!verifyPhaseStarted) {
    verifyPhaseStarted = true
    phase("Verify")
  }
}

/** Adversarial votes with early exit once outcome is decided. */
async function verifyClaimWithEarlyExit(claim) {
  ensureVerifyPhase()
  const verdicts = []

  for (let v = 0; v < VOTES_PER_CLAIM; v++) {
    const verdict = await agent(VERIFY_PROMPT(claim, v), {
      label: "v" + v + ":" + claim.claim.slice(0, 40),
      phase: "Verify",
      schema: VERDICT_SCHEMA,
    }).catch(e => {
      log("verify vote failed: " + (e.message || e))
      return null
    })

    totalVotesCast++
    if (verdict) verdicts.push(verdict)

    const refuted = verdicts.filter(x => x.refuted).length
    const valid = verdicts.length
    const votesDone = v + 1
    const votesRemaining = VOTES_PER_CLAIM - votesDone

    if (refuted >= REFUTATIONS_REQUIRED) break
    if (valid >= REFUTATIONS_REQUIRED && refuted + votesRemaining < REFUTATIONS_REQUIRED) break
  }

  const valid = verdicts.filter(Boolean)
  const refuted = valid.filter(v => v.refuted).length
  const abstained = VOTES_PER_CLAIM - valid.length
  const survives = valid.length >= REFUTATIONS_REQUIRED && refuted < REFUTATIONS_REQUIRED
  log("\"" + claim.claim.slice(0, 50) + "…\": " + (valid.length - refuted) + "-" + refuted + (abstained > 0 ? " (" + abstained + " abstain)" : "") + " " + (survives ? "✓" : "✗"))
  return { ...claim, verdicts: valid, refutedVotes: refuted, survives }
}

/** Start verify jobs for top-ranked claims not yet scheduled. */
function scheduleEligibleVerifies() {
  const ranked = rankClaims(allClaims)
  for (const claim of ranked) {
    const key = claimKey(claim)
    if (verifyStarted.has(key)) continue
    verifyStarted.add(key)
    verifyPool.run(async () => {
      try {
        const result = await verifyClaimWithEarlyExit(claim)
        voted.push(result)
        return result
      } catch (e) {
        log("verify failed: \"" + claim.claim.slice(0, 40) + "…\" — " + (e.message || e))
        return null
      }
    })
  }
}

function enqueueFetch(source, angle) {
  const key = normURL(source.url)
  if (seen.has(key)) {
    dupes.push({ ...source, angle, dupOf: seen.get(key) })
    return
  }
  if (fetchSlots <= 0 && relRank[source.relevance] >= 1) {
    budgetDropped.push({ ...source, angle })
    return
  }
  seen.set(key, { angle, title: source.title })
  fetchSlots--
  ensureFetchPhase()

  fetchPool.run(async () => {
    try {
      const ext = await agent(FETCH_PROMPT(source, angle), {
        label: fetchAgentLabel(source.url),
        phase: "Fetch",
        schema: EXTRACT_SCHEMA,
      })
      if (!ext) return null
      const result = {
        url: source.url, title: source.title, angle,
        sourceQuality: ext.sourceQuality, publishDate: ext.publishDate,
        claims: ext.claims.map(c => ({ ...c, sourceUrl: source.url, sourceQuality: ext.sourceQuality })),
      }
      allSources.push(result)
      if (result.claims.length > 0) {
        allClaims.push(...result.claims)
        scheduleEligibleVerifies()
      }
      return result
    } catch (e) {
      log("fetch failed: " + source.url + " — " + (e.message || e))
      const fallback = { url: source.url, title: source.title, angle, sourceQuality: "unreliable", claims: [] }
      allSources.push(fallback)
      return fallback
    }
  })
}

// ─── Search → Fetch stream: enqueue fetches as each search completes ───
phase("Search")
log("Search: " + scope.angles.length + " angles (streaming into Fetch)")

const searchResults = (await parallel(
  scope.angles.map(angle => () =>
    agent(SEARCH_PROMPT(angle), {
      label: "search:" + angle.label,
      phase: "Search",
      schema: SEARCH_SCHEMA,
    }).then(r => {
      if (!r) return null
      log(angle.label + ": " + r.results.length + " results")
      const sorted = [...r.results].sort((a, b) => relRank[a.relevance] - relRank[b.relevance])
      for (const source of sorted) {
        enqueueFetch(source, angle.label)
      }
      return { angle: angle.label, results: r.results }
    }).catch(e => {
      log(angle.label + " search failed: " + (e.message || e))
      return null
    })
  ),
  SEARCH_CONCURRENCY,
)).filter(Boolean)

await fetchPool.idle()

if (budgetDropped.length > 0) {
  const preview = budgetDropped.slice(0, 5).map(r => {
    try { return new URL(r.url).hostname } catch { return r.url }
  }).join(", ")
  const more = budgetDropped.length > 5 ? " +" + (budgetDropped.length - 5) + " more" : ""
  log("Fetch: dropped " + budgetDropped.length + " URLs (budget limit " + MAX_FETCH + "): " + preview + more)
}
log("Fetch: " + allSources.length + " sources (" + dupes.length + " dupes, " + budgetDropped.length + " budget-dropped)")

scheduleEligibleVerifies()
await verifyPool.idle()

const rankedClaims = rankClaims(allClaims)
log("Fetched " + allSources.length + " sources → " + allClaims.length + " claims → verified top " + rankedClaims.length + " (" + totalVotesCast + " votes cast)")

if (rankedClaims.length === 0) {
  return {
    question: QUESTION,
    summary: "No claims extracted. " + allSources.length + " sources fetched, all empty/failed. " + dupes.length + " URL dupes, " + budgetDropped.length + " budget-dropped.",
    findings: [], refuted: [], sources: allSources.map(s => ({ url: s.url, quality: s.sourceQuality })),
    stats: { angles: scope.angles.length, sources: allSources.length, claims: 0, dupes: dupes.length },
  }
}

const confirmed = voted.filter(c => c && c.survives)
const killed = voted.filter(c => c && !c.survives)
log("Verify done: " + voted.length + " claims → " + confirmed.length + " confirmed, " + killed.length + " killed")

if (confirmed.length === 0) {
  return {
    question: QUESTION,
    summary: "All " + voted.length + " claims refuted by adversarial verification. Research inconclusive — sources may be low-quality or claims overstated.",
    findings: [],
    refuted: killed.map(c => ({ claim: c.claim, vote: (c.verdicts.length - c.refutedVotes) + "-" + c.refutedVotes, source: c.sourceUrl })),
    sources: allSources.map(s => ({ url: s.url, quality: s.sourceQuality, claimCount: s.claims.length })),
    stats: { angles: scope.angles.length, sources: allSources.length, claims: allClaims.length, verified: voted.length, confirmed: 0, killed: killed.length, votesCast: totalVotesCast },
  }
}

// ─── Synthesize ───
phase("Synthesize")
const confRank = { high: 0, medium: 1, low: 2 }
const block = confirmed.map((c, i) => {
  const best = c.verdicts.filter(v => !v.refuted).sort((a, b) => confRank[a.confidence] - confRank[b.confidence])[0]
  return "### [" + i + "] " + c.claim + "\n" +
    "Vote: " + (c.verdicts.length - c.refutedVotes) + "-" + c.refutedVotes + " · Source: " + c.sourceUrl + " (" + c.sourceQuality + ")\n" +
    "Quote: \"" + c.quote + "\"\nVerifier evidence (" + best.confidence + "): " + best.evidence + "\n"
}).join("\n")

const killedBlock = killed.length > 0
  ? "\n## Refuted claims (for transparency)\n" +
    killed.map(c => "- \"" + c.claim + "\" (" + c.sourceUrl + ", vote " + (c.verdicts.length - c.refutedVotes) + "-" + c.refutedVotes + ")").join("\n")
  : ""

const report = await agent(
  "## Synthesis: research report\n\n" +
  "**Question:** " + QUESTION + "\n\n" +
  confirmed.length + " claims survived adversarial verification. Merge semantic duplicates and synthesize.\n\n" +
  "## Confirmed claims\n" + block + "\n" + killedBlock + "\n\n" +
  "## Instructions\n" +
  "1. Identify claims that say the same thing — merge them, combine their sources.\n" +
  "2. Group related claims into coherent findings. Each finding should directly address the research question.\n" +
  "3. Assign confidence per finding: high (multiple primary sources, unanimous votes), medium (secondary sources or split votes), low (single source or blog-quality).\n" +
  "4. Write a 3-5 sentence executive summary answering the research question.\n" +
  "5. Note caveats: what's uncertain, what sources were weak, what time-sensitivity applies.\n" +
  "6. List 2-4 open questions that emerged but weren't answered.\n\nStructured output only.",
  { label: "synthesize", phase: "Synthesize", schema: REPORT_SCHEMA }
)

if (!report) {
  return {
    question: QUESTION,
    summary: "Synthesis step was skipped or failed — returning " + confirmed.length + " verified claims unmerged.",
    findings: [],
    confirmed: confirmed.map(c => ({ claim: c.claim, source: c.sourceUrl, quote: c.quote, vote: (c.verdicts.length - c.refutedVotes) + "-" + c.refutedVotes })),
    refuted: killed.map(c => ({ claim: c.claim, vote: (c.verdicts.length - c.refutedVotes) + "-" + c.refutedVotes, source: c.sourceUrl })),
    sources: allSources.map(s => ({ url: s.url, quality: s.sourceQuality, claimCount: s.claims.length })),
    stats: { angles: scope.angles.length, sources: allSources.length, claims: allClaims.length, verified: voted.length, confirmed: confirmed.length, killed: killed.length, afterSynthesis: 0, votesCast: totalVotesCast },
  }
}

return {
  question: QUESTION,
  ...report,
  refuted: killed.map(c => ({ claim: c.claim, vote: (c.verdicts.length - c.refutedVotes) + "-" + c.refutedVotes, source: c.sourceUrl })),
  sources: allSources.map(s => ({ url: s.url, quality: s.sourceQuality, angle: s.angle, claimCount: s.claims.length })),
  stats: {
    angles: scope.angles.length,
    sourcesFetched: allSources.length,
    claimsExtracted: allClaims.length,
    claimsVerified: voted.length,
    confirmed: confirmed.length,
    killed: killed.length,
    afterSynthesis: report.findings.length,
    urlDupes: dupes.length,
    budgetDropped: budgetDropped.length,
    votesCast: totalVotesCast,
    agentCalls: 1 + scope.angles.length + allSources.length + totalVotesCast + 1,
  },
}
